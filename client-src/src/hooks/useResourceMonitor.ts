import { useState, useEffect, useRef, useCallback } from 'react'
import { HEALTH_POLL_MS, HEALTH_POLL_FAST_MS, HISTORY_MAX_SAMPLES } from '@/terminal/constants'

// ─── PSI types ────────────────────────────────────────────────────────────────

export interface PsiEntry {
  avg10:  number
  avg60:  number
  avg300: number
}

export interface PsiMetrics {
  memory: { some?: PsiEntry; full?: PsiEntry } | null
  cpu:    { some?: PsiEntry; full?: PsiEntry } | null
  io:     { some?: PsiEntry; full?: PsiEntry } | null
}

// ─── I/O types ────────────────────────────────────────────────────────────────

export interface NetMetrics {
  rxBps:    number
  txBps:    number
  rxTotal?: number   // cumulative bytes since boot
  txTotal?: number
}

export interface DiskMetrics {
  readBps:  number
  writeBps: number
  ioBusy:   number   // 0.0-1.0
}

export interface MemBreakdown {
  totalMB:     number
  usedMB:      number
  cachedMB:    number
  buffersMB:   number
  availableMB: number
  swapTotalMB?: number
  swapUsedMB?:  number
  swapUsedPct?: number
}

export interface LoadAvg {
  load1:  number
  load5:  number
  load15: number
}

// ─── Extended /proc metrics ───────────────────────────────────────────────────

export interface FdMetrics {
  allocated: number
  free:      number
  max:       number
}

export interface SocketMetrics {
  tcp:   number
  udp:   number
  total: number
}

export interface DiskUsage {
  totalGB: number
  usedGB:  number
  freeGB:  number
  usedPct: number
}

export interface ProcessInfo {
  pid:    number
  comm:   string
  state:  string  // R, S, D, Z, T, I
  cpuPct: number
  rssMB:  number
}

export interface TopProcs {
  byCpu:        ProcessInfo[]
  byMem:        ProcessInfo[]
  totalProcs:   number
  totalThreads: number
}

// ─── Main metrics type ────────────────────────────────────────────────────────

export interface HealthMetrics {
  status:          'ok' | 'warn' | 'critical'
  cpu:             number | null
  ram:             number | null
  ramUsedMb:       number | null
  ramTotalMb:      number | null
  gpu:             number | null
  uptime:          number
  streamingPaused: boolean
  timestamp:       number
  cores:           number[] | null
  net:             NetMetrics | null
  disk:            DiskMetrics | null
  psi:             PsiMetrics | null
  memBreakdown:    MemBreakdown | null
  load:            LoadAvg | null
  swapUsedPercent: number | null
  activePtys:      number | null
  // Extended
  fds:             FdMetrics | null
  sockets:         SocketMetrics | null
  sysUptime:       number | null
  diskUsage:       DiskUsage | null
  top:             TopProcs | null
}

export interface HistorySample {
  ts:           number
  cpu:          number
  ram:          number
  netRxBps:     number
  netTxBps:     number
  diskReadBps:  number
  diskWriteBps: number
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_METRICS: HealthMetrics = {
  status: 'ok', cpu: null, ram: null, ramUsedMb: null, ramTotalMb: null,
  gpu: null, uptime: 0, streamingPaused: false, timestamp: 0,
  cores: null, net: null, disk: null, psi: null,
  memBreakdown: null, load: null, swapUsedPercent: null, activePtys: null,
  fds: null, sockets: null, sysUptime: null, diskUsage: null, top: null,
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useResourceMonitor() {
  const [metrics, setMetrics] = useState<HealthMetrics>(DEFAULT_METRICS)
  const [history, setHistory] = useState<HistorySample[]>([])

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef  = useRef(true)
  const statusRef   = useRef<string>('ok')
  const seededRef   = useRef(false)

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      if (!res.ok) return
      const data = await res.json()
      if (!mountedRef.current) return

      const newStatus = data.status ?? 'ok'
      statusRef.current = newStatus

      const m: HealthMetrics = {
        status:          newStatus,
        cpu:             data.cpu          ?? null,
        ram:             data.ram          ?? null,
        ramUsedMb:       data.ramUsedMb    ?? null,
        ramTotalMb:      data.ramTotalMb   ?? null,
        gpu:             data.gpu          ?? null,
        uptime:          data.uptime       ?? 0,
        streamingPaused: data.streamingPaused ?? false,
        timestamp:       data.timestamp    ?? Date.now(),
        cores:           data.cores        ?? null,
        net:             data.net          ?? null,
        disk:            data.disk         ?? null,
        psi:             data.psi          ?? null,
        memBreakdown:    data.memBreakdown ?? null,
        load:            data.load         ?? null,
        swapUsedPercent: data.swapUsedPercent ?? null,
        activePtys:      data.activePtys   ?? null,
        fds:             data.fds          ?? null,
        sockets:         data.sockets      ?? null,
        sysUptime:       data.sysUptime    ?? null,
        diskUsage:       data.diskUsage    ?? null,
        top:             data.top          ?? null,
      }

      setMetrics(m)

      if (m.cpu !== null && m.ram !== null) {
        setHistory(prev => {
          const next = [...prev, {
            ts:           m.timestamp,
            cpu:          m.cpu!,
            ram:          m.ram!,
            netRxBps:     m.net?.rxBps      ?? 0,
            netTxBps:     m.net?.txBps      ?? 0,
            diskReadBps:  m.disk?.readBps   ?? 0,
            diskWriteBps: m.disk?.writeBps  ?? 0,
          }]
          return next.length > HISTORY_MAX_SAMPLES ? next.slice(-HISTORY_MAX_SAMPLES) : next
        })
      }
    } catch { /* ignore */ }
  }, [])

  const seedHistory = useCallback(async () => {
    if (seededRef.current) return
    seededRef.current = true
    try {
      const res = await fetch('/api/metrics/history')
      if (!res.ok) return
      const data = await res.json()
      if (!mountedRef.current || !Array.isArray(data.history)) return
      setHistory(prev => prev.length === 0 ? data.history.slice(-HISTORY_MAX_SAMPLES) : prev)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    seedHistory()

    async function scheduleNext() {
      await fetchMetrics()
      if (cancelled) return
      const interval = statusRef.current === 'ok' ? HEALTH_POLL_MS : HEALTH_POLL_FAST_MS
      timerRef.current = setTimeout(scheduleNext, interval)
    }

    scheduleNext()

    return () => {
      cancelled = true
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetchMetrics, seedHistory])

  return { metrics, history }
}
