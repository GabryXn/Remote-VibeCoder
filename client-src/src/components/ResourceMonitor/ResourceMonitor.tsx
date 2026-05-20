import { useState, useCallback, useRef, useEffect } from 'react'
import type { HealthMetrics, HistorySample, ProcessInfo } from '@/hooks/useResourceMonitor'
import { MetricSparkline } from './MetricSparkline'
import styles from './ResourceMonitor.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metricState(value: number | null, warn = 0.80, critical = 0.90): 'ok' | 'warn' | 'critical' {
  if (value === null) return 'ok'
  if (value >= critical) return 'critical'
  if (value >= warn)     return 'warn'
  return 'ok'
}

function fmtPct(v: number | null, decimals = 0): string {
  if (v === null) return 'N/A'
  return `${v < 1 ? (v * 100).toFixed(decimals) : Math.round(v * 100)}%`
}

function fmtBytes(bps: number | null): string {
  if (bps === null) return '–'
  if (bps === 0)          return '0 B/s'
  if (bps < 1024)         return `${bps} B/s`
  if (bps < 1_048_576)    return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1_048_576).toFixed(1)} MB/s`
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(seconds % 60)}s`
}

function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function fmtBytesTotal(b: number | undefined): string {
  if (!b) return '–'
  if (b < 1_048_576)        return `${(b / 1024).toFixed(0)} KB`
  if (b < 1_073_741_824)    return `${(b / 1_048_576).toFixed(1)} MB`
  return `${(b / 1_073_741_824).toFixed(2)} GB`
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Process state code → short label
const STATE_LABEL: Record<string, string> = {
  R: 'run', S: 'sleep', D: 'wait', Z: 'zomb', T: 'stop', I: 'idle',
}

// ─── Compact status pill (used in ResourceBar + widget header) ─────────────────

interface StatusPillProps {
  label: string
  value: number | null
  state: 'ok' | 'warn' | 'critical'
  color: string
}

export function StatusPill({ label, value, state, color }: StatusPillProps) {
  const pct = value !== null ? Math.round(value * 100) : null
  const barColor = state === 'critical' ? '#ef4444' : state === 'warn' ? '#f59e0b' : color
  return (
    <div className={styles.pill}>
      <span className={styles.pillLabel}>{label}</span>
      <div className={styles.pillTrack}>
        <div
          className={[styles.pillFill, styles[`pillState${state.charAt(0).toUpperCase() + state.slice(1)}`]].join(' ')}
          style={{ width: pct !== null ? `${pct}%` : '0%', background: barColor }}
        />
      </div>
      <span className={[styles.pillValue, state !== 'ok' ? styles[state] : ''].filter(Boolean).join(' ')}>
        {pct !== null ? `${pct}%` : <span className={styles.naText}>–</span>}
      </span>
    </div>
  )
}

// ─── Glowing progress bar ─────────────────────────────────────────────────────

interface GlowBarProps {
  value: number | null   // 0.0 – 1.0
  color: string
  state?: 'ok' | 'warn' | 'critical'
  height?: number
}

function GlowBar({ value, color, state = 'ok', height = 6 }: GlowBarProps) {
  const pct = value !== null ? Math.round(value * 100) : 0
  const c = state === 'critical' ? '#ef4444' : state === 'warn' ? '#f59e0b' : color
  return (
    <div className={styles.glowTrack} style={{ height }}>
      <div
        className={[styles.glowFill, state === 'critical' ? styles.glowPulse : ''].filter(Boolean).join(' ')}
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${c}aa, ${c})`,
          boxShadow: `0 0 8px ${c}66`,
        }}
      />
    </div>
  )
}

// ─── Per-core heatmap ─────────────────────────────────────────────────────────

function CoreGrid({ cores }: { cores: number[] | null }) {
  if (!cores || cores.length === 0) return null
  return (
    <div className={styles.coreGrid}>
      {cores.map((v, i) => {
        const pct   = Math.round(v * 100)
        const state = metricState(v)
        const color = state === 'critical' ? '#ef4444' : state === 'warn' ? '#f59e0b' : '#22c55e'
        return (
          <div key={i} className={styles.coreCell} title={`Core ${i}: ${pct}%`}>
            <div className={styles.coreName}>C{i}</div>
            <div className={styles.coreBar}>
              <div
                className={styles.coreFill}
                style={{
                  height: `${pct}%`,
                  background: color,
                  boxShadow: pct > 40 ? `0 0 6px ${color}66` : 'none',
                }}
              />
            </div>
            <div className={[styles.coreValue, state !== 'ok' ? styles[state] : ''].filter(Boolean).join(' ')}>
              {pct}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Segmented memory bar ─────────────────────────────────────────────────────

function MemBar({ breakdown }: { breakdown: NonNullable<HealthMetrics['memBreakdown']> }) {
  const { totalMB, usedMB, cachedMB, buffersMB, availableMB } = breakdown
  if (totalMB === 0) return null
  const usedPct    = (usedMB    / totalMB) * 100
  const cachedPct  = (cachedMB  / totalMB) * 100
  const buffersPct = (buffersMB / totalMB) * 100
  return (
    <div className={styles.memBarWrap}>
      <div className={styles.memBarTrack}>
        <div className={styles.memUsed}    style={{ width: `${usedPct.toFixed(1)}%` }}    title={`Used: ${fmtMB(usedMB)}`} />
        <div className={styles.memCached}  style={{ width: `${cachedPct.toFixed(1)}%` }}  title={`Cache: ${fmtMB(cachedMB)}`} />
        <div className={styles.memBuffers} style={{ width: `${buffersPct.toFixed(1)}%` }} title={`Buffers: ${fmtMB(buffersMB)}`} />
      </div>
      <div className={styles.memLegend}>
        <span className={styles.memChip} style={{ '--chip-color': '#ef4444' } as React.CSSProperties}>
          <span className={styles.memDot} style={{ background: '#ef4444' }} />Used {fmtMB(usedMB)}
        </span>
        <span className={styles.memChip} style={{ '--chip-color': '#3b82f6' } as React.CSSProperties}>
          <span className={styles.memDot} style={{ background: '#3b82f6' }} />Cache {fmtMB(cachedMB)}
        </span>
        <span className={styles.memChip} style={{ '--chip-color': '#8b5cf6' } as React.CSSProperties}>
          <span className={styles.memDot} style={{ background: '#8b5cf6' }} />Buf {fmtMB(buffersMB)}
        </span>
        <span className={styles.memChip} style={{ '--chip-color': '#4d4d4d' } as React.CSSProperties}>
          <span className={styles.memDot} style={{ background: '#555' }} />Free {fmtMB(availableMB)}
        </span>
      </div>
    </div>
  )
}

// ─── PSI pressure gauge ───────────────────────────────────────────────────────

interface PsiGaugeProps {
  label: string
  stall: number | undefined
}

function PsiGauge({ label, stall }: PsiGaugeProps) {
  if (stall === undefined) return null
  const state = stall >= 30 ? 'critical' : stall >= 5 ? 'warn' : 'ok'
  const color = state === 'critical' ? '#ef4444' : state === 'warn' ? '#f59e0b' : '#22c55e'
  return (
    <div className={styles.psiGauge}>
      <div className={styles.psiGaugeLabel}>{label}</div>
      <div className={styles.psiGaugeBar}>
        <div
          className={styles.psiGaugeFill}
          style={{
            width: `${Math.min(100, stall)}%`,
            background: color,
            boxShadow: stall > 0 ? `0 0 6px ${color}88` : 'none',
          }}
        />
      </div>
      <span className={[styles.psiGaugeValue, state !== 'ok' ? styles[state] : ''].filter(Boolean).join(' ')}>
        {stall.toFixed(1)}%
      </span>
    </div>
  )
}

// ─── I/O row with sparkline ───────────────────────────────────────────────────

interface IoRowProps {
  icon:    string
  label:   string
  value:   number | null
  history: number[]
  color:   string
}

function IoRow({ icon, label, value, history, color }: IoRowProps) {
  return (
    <div className={styles.ioRow}>
      <span className={styles.ioIcon} style={{ color }}>{icon}</span>
      <span className={styles.ioLabel}>{label}</span>
      <MetricSparkline data={history} color={color} width={72} height={22} />
      <span className={styles.ioValue} style={{ color: value && value > 0 ? color : undefined }}>
        {fmtBytes(value)}
      </span>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SecHeader({ icon, label, value, color, state, extra }: {
  icon: string; label: string; value?: string; color: string
  state?: 'ok' | 'warn' | 'critical'; extra?: React.ReactNode
}) {
  return (
    <div className={styles.secHeader}>
      <span className={styles.secIcon} style={{ color }}>{icon}</span>
      <span className={styles.secLabel}>{label}</span>
      {extra}
      {value && (
        <span
          className={[styles.secValue, state && state !== 'ok' ? styles[state] : ''].filter(Boolean).join(' ')}
          style={{ color: state === 'ok' || !state ? color : undefined }}
        >
          {value}
        </span>
      )}
    </div>
  )
}

// ─── Top processes table ──────────────────────────────────────────────────────

function ProcessTable({ rows, sortBy }: { rows: ProcessInfo[]; sortBy: 'cpu' | 'mem' }) {
  if (!rows || rows.length === 0) return <span className={styles.naText}>no data</span>
  return (
    <div className={styles.procTable}>
      <div className={[styles.procRow, styles.procHead].join(' ')}>
        <span className={styles.procPid}>PID</span>
        <span className={styles.procName}>COMMAND</span>
        <span className={styles.procState}>S</span>
        <span className={[styles.procCpu, sortBy === 'cpu' ? styles.procColActive : ''].join(' ')}>CPU%</span>
        <span className={[styles.procMem, sortBy === 'mem' ? styles.procColActive : ''].join(' ')}>RSS</span>
      </div>
      {rows.map(p => {
        const cpuHigh = p.cpuPct > 50
        const memHigh = p.rssMB > 512
        return (
          <div key={p.pid} className={styles.procRow}>
            <span className={styles.procPid}>{p.pid}</span>
            <span className={styles.procName} title={p.comm}>{p.comm}</span>
            <span className={[styles.procState, p.state === 'R' ? styles.procStateRun : ''].join(' ')}>
              {STATE_LABEL[p.state] ?? p.state}
            </span>
            <span className={[styles.procCpu, cpuHigh ? styles.procHot : ''].join(' ')}>
              {p.cpuPct.toFixed(1)}
            </span>
            <span className={[styles.procMem, memHigh ? styles.procHot : ''].join(' ')}>
              {p.rssMB >= 1024 ? `${(p.rssMB / 1024).toFixed(1)}G` : `${p.rssMB}M`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Info chip (small KV pair) ────────────────────────────────────────────────

function InfoChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={styles.infoChip}>
      <span className={styles.infoChipLabel}>{label}</span>
      <span className={styles.infoChipValue} style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ResourceMonitorProps {
  metrics:  HealthMetrics
  history?: HistorySample[]
  compact?: boolean
}

export function ResourceMonitor({ metrics, history = [], compact = false }: ResourceMonitorProps) {
  const [open, setOpen] = useState(false)
  const [procSort, setProcSort] = useState<'cpu' | 'mem'>('cpu')
  const widgetRef = useRef<HTMLDivElement>(null)

  const cpuState = metricState(metrics.cpu)
  const ramState = metricState(metrics.ram)
  const gpuState = metricState(metrics.gpu)

  const activeStates: Array<'ok' | 'warn' | 'critical'> = [cpuState, ramState]
  if (metrics.gpu !== null) activeStates.push(gpuState)
  const widgetState: 'ok' | 'warn' | 'critical' = activeStates.includes('critical') ? 'critical'
    : activeStates.includes('warn') ? 'warn' : 'ok'

  const isPaused    = metrics.streamingPaused
  const isSuspended = metrics.status === 'critical' && !isPaused

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const toggle = useCallback(() => setOpen(v => !v), [])

  // History arrays
  const cpuHist     = history.map(s => s.cpu)
  const ramHist     = history.map(s => s.ram)
  const netRxHist   = history.map(s => s.netRxBps ?? 0)
  const netTxHist   = history.map(s => s.netTxBps ?? 0)
  const diskRHist   = history.map(s => s.diskReadBps ?? 0)
  const diskWHist   = history.map(s => s.diskWriteBps ?? 0)

  const cpuColor = cpuState === 'critical' ? '#ef4444' : cpuState === 'warn' ? '#f59e0b' : '#22c55e'
  const ramColor = ramState === 'critical' ? '#ef4444' : ramState === 'warn' ? '#f59e0b' : '#3b82f6'

  // PSI stalls
  const psiMem = metrics.psi?.memory?.some?.avg10
  const psiCpu = metrics.psi?.cpu?.some?.avg10
  const psiIo  = metrics.psi?.io?.some?.avg10
  const anyPsiStall = (psiMem ?? 0) > 0 || (psiCpu ?? 0) > 0 || (psiIo ?? 0) > 0

  return (
    <div
      ref={widgetRef}
      className={[
        styles.widget,
        compact ? styles.widgetCompact : '',
        widgetState !== 'ok' ? styles[widgetState] : '',
        open ? styles.widgetOpen : '',
      ].filter(Boolean).join(' ')}
      onClick={toggle}
      title="VM Resources — click for details"
    >
      {/* ── Status dot ── */}
      <div className={[styles.statusDot, styles[`dot${widgetState.charAt(0).toUpperCase() + widgetState.slice(1)}`]].join(' ')} />

      {/* ── Compact metrics ── */}
      <div className={styles.pills}>
        <StatusPill label="CPU" value={metrics.cpu} state={cpuState} color="#22c55e" />
        <StatusPill label="RAM" value={metrics.ram} state={ramState} color="#3b82f6" />
        {metrics.gpu !== null && (
          <StatusPill label="GPU" value={metrics.gpu} state={gpuState} color="#a855f7" />
        )}
      </div>

      {/* ── Stream state badge ── */}
      {isPaused && <span className={[styles.streamBadge, styles.badgePaused].join(' ')}>⏸</span>}
      {isSuspended && <span className={[styles.streamBadge, styles.badgeCritical].join(' ')}>●</span>}

      {/* ── Open chevron ── */}
      <span className={[styles.chevron, open ? styles.chevronOpen : ''].join(' ')}>›</span>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/*  FULL PANEL                                                         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {open && (
        <div className={styles.panel} onClick={e => e.stopPropagation()}>

          {/* ── Panel header ── */}
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              <span className={styles.panelTitleIcon}>⬡</span>
              VM RESOURCES
            </div>
            <div className={styles.panelMeta}>
              <span className={styles.metaChip}>OCI ARM A1</span>
              <span className={styles.metaUptime}>
                ↑ {fmtUptime(metrics.uptime)}
              </span>
            </div>
          </div>

          {/* ── Load average banner ── */}
          {metrics.load && (
            <div className={styles.loadBanner}>
              <span className={styles.loadLabel}>LOAD</span>
              <span className={styles.loadValues}>
                <span>{metrics.load.load1.toFixed(2)}</span>
                <span className={styles.loadSep}>/</span>
                <span>{metrics.load.load5.toFixed(2)}</span>
                <span className={styles.loadSep}>/</span>
                <span>{metrics.load.load15.toFixed(2)}</span>
              </span>
              <span className={styles.loadHint}>1m · 5m · 15m</span>
              <span className={styles.loadPty}>
                {metrics.activePtys ?? 0} PTY
              </span>
            </div>
          )}

          {/* ── CPU ── */}
          <div className={styles.section}>
            <SecHeader
              icon="◈" label="CPU" color={cpuColor} state={cpuState}
              value={fmtPct(metrics.cpu)}
              extra={<MetricSparkline data={cpuHist} color={cpuColor} width={80} height={22} className={styles.headerSparkline} />}
            />
            <GlowBar value={metrics.cpu} color="#22c55e" state={cpuState} height={7} />
            <CoreGrid cores={metrics.cores} />
          </div>

          {/* ── Memory ── */}
          <div className={styles.section}>
            <SecHeader
              icon="◉" label="MEM" color={ramColor} state={ramState}
              value={
                metrics.ramUsedMb !== null && metrics.ramTotalMb !== null
                  ? `${fmtMB(metrics.ramUsedMb)} / ${fmtMB(metrics.ramTotalMb)}`
                  : fmtPct(metrics.ram)
              }
              extra={<MetricSparkline data={ramHist} color={ramColor} width={80} height={22} className={styles.headerSparkline} />}
            />
            <GlowBar value={metrics.ram} color="#3b82f6" state={ramState} height={7} />
            {metrics.memBreakdown && <MemBar breakdown={metrics.memBreakdown} />}
            {metrics.swapUsedPercent !== null && metrics.swapUsedPercent > 0 && (
              <div className={styles.swapRow}>
                <span className={styles.swapLabel}>SWAP</span>
                <div className={styles.swapBarTrack}>
                  <div className={styles.swapBarFill} style={{ width: `${metrics.swapUsedPercent}%` }} />
                </div>
                <span className={styles.swapValue}>{metrics.swapUsedPercent}%</span>
              </div>
            )}
          </div>

          {/* ── Network I/O ── */}
          <div className={styles.section}>
            <SecHeader icon="⇄" label="NETWORK" color="#06b6d4" />
            <IoRow icon="↓" label="RX" value={metrics.net?.rxBps ?? null} history={netRxHist} color="#06b6d4" />
            <IoRow icon="↑" label="TX" value={metrics.net?.txBps ?? null} history={netTxHist} color="#a78bfa" />
          </div>

          {/* ── Disk I/O ── */}
          <div className={styles.section}>
            <SecHeader
              icon="◫" label="DISK" color="#f59e0b"
              extra={
                metrics.disk && metrics.disk.ioBusy > 0.01
                  ? <span className={styles.diskBusy}>busy {Math.round(metrics.disk.ioBusy * 100)}%</span>
                  : undefined
              }
            />
            <IoRow icon="R" label="READ"  value={metrics.disk?.readBps  ?? null} history={diskRHist} color="#f59e0b" />
            <IoRow icon="W" label="WRITE" value={metrics.disk?.writeBps ?? null} history={diskWHist} color="#fb923c" />
          </div>

          {/* ── Pressure (PSI) ── */}
          <div className={styles.section}>
            <SecHeader icon="⚡" label="PRESSURE (PSI)" color={anyPsiStall ? '#f472b6' : '#555'} />
            {metrics.psi ? (
              <div className={styles.psiGrid}>
                <PsiGauge label="MEM" stall={psiMem} />
                <PsiGauge label="CPU" stall={psiCpu} />
                <PsiGauge label="I/O" stall={psiIo} />
              </div>
            ) : (
              <span className={styles.naText}>not available</span>
            )}
          </div>

          {/* ── Top processes ── */}
          {metrics.top && (
            <div className={styles.section}>
              <SecHeader
                icon="⌬"
                label="PROCESSES"
                color="#10b981"
                value={metrics.top.totalProcs > 0 ? `${metrics.top.totalProcs} procs · ${metrics.top.totalThreads} thr` : undefined}
                extra={
                  <div className={styles.procTabs}>
                    <button
                      className={[styles.procTab, procSort === 'cpu' ? styles.procTabActive : ''].join(' ')}
                      onClick={() => setProcSort('cpu')}
                      type="button"
                    >CPU</button>
                    <button
                      className={[styles.procTab, procSort === 'mem' ? styles.procTabActive : ''].join(' ')}
                      onClick={() => setProcSort('mem')}
                      type="button"
                    >MEM</button>
                  </div>
                }
              />
              <ProcessTable
                rows={procSort === 'cpu' ? metrics.top.byCpu : metrics.top.byMem}
                sortBy={procSort}
              />
            </div>
          )}

          {/* ── System info (FDs, sockets, disk space, totals) ── */}
          <div className={styles.section}>
            <SecHeader icon="◇" label="SYSTEM" color="#94a3b8" />
            <div className={styles.infoGrid}>
              {metrics.fds && (
                <InfoChip
                  label="FD"
                  value={`${fmtNum(metrics.fds.allocated)} / ${fmtNum(metrics.fds.max)}`}
                  color={metrics.fds.allocated / metrics.fds.max > 0.7 ? '#f59e0b' : undefined}
                />
              )}
              {metrics.sockets && (
                <>
                  <InfoChip label="TCP" value={fmtNum(metrics.sockets.tcp)} color="#06b6d4" />
                  <InfoChip label="UDP" value={fmtNum(metrics.sockets.udp)} color="#a78bfa" />
                  <InfoChip label="SOCK" value={fmtNum(metrics.sockets.total)} />
                </>
              )}
              {metrics.diskUsage && (
                <InfoChip
                  label="DISK"
                  value={`${metrics.diskUsage.usedGB}/${metrics.diskUsage.totalGB}G (${metrics.diskUsage.usedPct}%)`}
                  color={metrics.diskUsage.usedPct > 85 ? '#ef4444' : metrics.diskUsage.usedPct > 70 ? '#f59e0b' : '#22c55e'}
                />
              )}
              {metrics.memBreakdown?.swapTotalMB && metrics.memBreakdown.swapTotalMB > 0 && (
                <InfoChip
                  label="SWAP"
                  value={`${fmtMB(metrics.memBreakdown.swapUsedMB ?? 0)} / ${fmtMB(metrics.memBreakdown.swapTotalMB)}`}
                  color={(metrics.memBreakdown.swapUsedPct ?? 0) > 50 ? '#f59e0b' : '#8b5cf6'}
                />
              )}
              {metrics.net && metrics.net.rxTotal !== undefined && (
                <InfoChip label="NET ↓Σ" value={fmtBytesTotal(metrics.net.rxTotal)} color="#06b6d4" />
              )}
              {metrics.net && metrics.net.txTotal !== undefined && (
                <InfoChip label="NET ↑Σ" value={fmtBytesTotal(metrics.net.txTotal)} color="#a78bfa" />
              )}
              {metrics.sysUptime !== null && (
                <InfoChip label="HOST UP" value={fmtUptime(metrics.sysUptime ?? 0)} />
              )}
            </div>
          </div>

          {/* ── GPU (optional) ── */}
          {metrics.gpu !== null && (
            <div className={styles.section}>
              <SecHeader icon="◈" label="GPU" color="#a855f7" state={gpuState} value={fmtPct(metrics.gpu)} />
              <GlowBar value={metrics.gpu} color="#a855f7" state={gpuState} height={7} />
            </div>
          )}

          {/* ── Streaming status ── */}
          <div className={styles.streamRow}>
            <span className={styles.streamLabel}>STREAM</span>
            <span className={[
              styles.streamStatus,
              isPaused ? styles.streamPaused : isSuspended ? styles.streamSuspended : styles.streamActive,
            ].join(' ')}>
              {isPaused ? '⏸ PAUSED' : isSuspended ? '● SUSPENDED' : '▶ ACTIVE'}
            </span>
          </div>

        </div>
      )}
    </div>
  )
}
