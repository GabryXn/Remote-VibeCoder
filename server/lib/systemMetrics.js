'use strict';

/**
 * systemMetrics — granular /proc metrics with no external dependencies.
 *
 * Reads PSI, per-core CPU, network I/O rates, disk I/O rates, memory breakdown,
 * swap, file descriptors, socket counts, and top-N processes from Linux /proc.
 * Zero subprocess, zero external tools — pure synchronous /proc readers in-process.
 *
 * Two-tier ticker:
 *   - Fast tick (1 s)  → PSI, per-core CPU, net/disk rates, mem, swap, fd/sockets, history append
 *   - Slow tick (2 s)  → /proc/[pid]/stat scan for top processes (more expensive)
 *
 * Public API: start(), stop(), latest(), history(), readPsi()
 */

const fs = require('fs');

const FAST_MS         = 1000;
const PROC_SCAN_MS    = 2000;
const HISTORY_SAMPLES = 60;   // 60 × 1 s = last 60 seconds
const TOP_N_CPU       = 10;
const TOP_N_MEM       = 10;

// ─── PSI (Pressure Stall Information) ────────────────────────────────────────

function _parsePsiLine(line) {
  const m = line.match(/avg10=([\d.]+) avg60=([\d.]+) avg300=([\d.]+)/);
  return m ? { avg10: parseFloat(m[1]), avg60: parseFloat(m[2]), avg300: parseFloat(m[3]) } : null;
}

function readPsi() {
  const result = {};
  for (const r of ['memory', 'cpu', 'io']) {
    try {
      const raw   = fs.readFileSync(`/proc/pressure/${r}`, 'utf8');
      const entry = {};
      for (const line of raw.trim().split('\n')) {
        const type   = line.startsWith('some') ? 'some' : 'full';
        const parsed = _parsePsiLine(line);
        if (parsed) entry[type] = parsed;
      }
      result[r] = Object.keys(entry).length ? entry : null;
    } catch {
      result[r] = null;
    }
  }
  return result;
}

// ─── Per-core CPU (differential) ─────────────────────────────────────────────

let _prevCores = null;

function _readCoreStats() {
  try {
    const raw = fs.readFileSync('/proc/stat', 'utf8');
    return raw.split('\n')
      .filter(l => /^cpu\d/.test(l))
      .map(line => {
        const v = line.trim().split(/\s+/).slice(1).map(Number);
        return { idle: v[3] + (v[4] || 0), total: v.reduce((s, x) => s + x, 0) };
      });
  } catch { return null; }
}

function _sampleCoreCpu() {
  const curr = _readCoreStats();
  const prev = _prevCores;
  _prevCores = curr;
  if (!prev || !curr || prev.length !== curr.length) return null;
  return curr.map((c, i) => {
    const dt = c.total - prev[i].total;
    if (dt === 0) return 0;
    return Math.max(0, Math.min(1, 1 - (c.idle - prev[i].idle) / dt));
  });
}

// ─── Network I/O rate ─────────────────────────────────────────────────────────

let _prevNet     = null;
let _prevNetTime = 0;
let _netRate     = null;
let _netTotals   = { rxTotal: 0, txTotal: 0 };

function _readNetRaw() {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    let rx = 0, tx = 0;
    for (const line of raw.split('\n').slice(2)) {
      const p     = line.trim().split(/\s+/);
      if (p.length < 10) continue;
      const iface = p[0].replace(':', '');
      if (iface === 'lo' || /^(docker|br-|veth|virbr)/.test(iface)) continue;
      rx += parseInt(p[1], 10) || 0;
      tx += parseInt(p[9], 10) || 0;
    }
    return { rx, tx };
  } catch { return null; }
}

function _sampleNet() {
  const curr  = _readNetRaw();
  const now   = Date.now();
  const prev  = _prevNet;
  const prevT = _prevNetTime;
  _prevNet     = curr;
  _prevNetTime = now;
  if (!curr) return;
  _netTotals = { rxTotal: curr.rx, txTotal: curr.tx };
  if (!prev || prevT === 0) return;
  const dt = (now - prevT) / 1000;
  if (dt <= 0) return;
  _netRate = {
    rxBps: Math.max(0, Math.round((curr.rx - prev.rx) / dt)),
    txBps: Math.max(0, Math.round((curr.tx - prev.tx) / dt)),
    rxTotal: curr.rx,
    txTotal: curr.tx,
  };
}

// ─── Disk I/O rate ────────────────────────────────────────────────────────────

let _prevDisk     = null;
let _prevDiskTime = 0;
let _diskRate     = null;

function _readDiskRaw() {
  try {
    const raw = fs.readFileSync('/proc/diskstats', 'utf8');
    let sectorsR = 0, sectorsW = 0, ioMs = 0;
    for (const line of raw.split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p.length < 13) continue;
      const name = p[2];
      if (!/^(sd[a-z]|vd[a-z]|nvme\d+n\d+|xvd[a-z])$/.test(name)) continue;
      sectorsR += parseInt(p[5],  10) || 0;
      sectorsW += parseInt(p[9],  10) || 0;
      ioMs     += parseInt(p[12], 10) || 0;
    }
    return { sectorsR, sectorsW, ioMs };
  } catch { return null; }
}

function _sampleDisk() {
  const curr  = _readDiskRaw();
  const now   = Date.now();
  const prev  = _prevDisk;
  const prevT = _prevDiskTime;
  _prevDisk     = curr;
  _prevDiskTime = now;
  if (!prev || !curr || prevT === 0) return;
  const dt = (now - prevT) / 1000;
  if (dt <= 0) return;
  const SECTOR = 512;
  _diskRate = {
    readBps:  Math.max(0, Math.round((curr.sectorsR - prev.sectorsR) * SECTOR / dt)),
    writeBps: Math.max(0, Math.round((curr.sectorsW - prev.sectorsW) * SECTOR / dt)),
    ioBusy:   Math.min(1, Math.max(0, (curr.ioMs - prev.ioMs) / (dt * 1000))),
  };
}

// ─── Disk usage on / (statvfs via fs.statfsSync — node 18+) ───────────────────

let _diskUsage = null;
let _lastDiskUsageT = 0;

function _readDiskUsage() {
  // Throttled — disk space changes slowly, refresh every 10 s
  const now = Date.now();
  if (now - _lastDiskUsageT < 10_000 && _diskUsage) return _diskUsage;
  _lastDiskUsageT = now;
  try {
    const st = fs.statfsSync('/');
    const total = st.blocks * st.bsize;
    const free  = st.bavail * st.bsize;
    _diskUsage = {
      totalGB: +(total / 1073741824).toFixed(1),
      usedGB:  +((total - free) / 1073741824).toFixed(1),
      freeGB:  +(free / 1073741824).toFixed(1),
      usedPct: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
    };
  } catch {
    _diskUsage = null;
  }
  return _diskUsage;
}

// ─── Memory + Swap breakdown ──────────────────────────────────────────────────

function readMemBreakdown() {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const map = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) map[m[1]] = parseInt(m[2], 10) * 1024;
    }
    const total   = map.MemTotal     || 0;
    const free    = map.MemFree      || 0;
    const buffers = map.Buffers      || 0;
    const cached  = Math.max(0, (map.Cached || 0) - (map.Shmem || 0) + (map.SReclaimable || 0));
    const avail   = map.MemAvailable || free;
    const used    = Math.max(0, total - free - buffers - cached);
    const swapT   = map.SwapTotal    || 0;
    const swapF   = map.SwapFree     || 0;
    const swapU   = Math.max(0, swapT - swapF);
    const MB = v => Math.round(v / 1048576);
    return {
      totalMB:     MB(total),
      usedMB:      MB(used),
      cachedMB:    MB(cached),
      buffersMB:   MB(buffers),
      availableMB: MB(avail),
      swapTotalMB: MB(swapT),
      swapUsedMB:  MB(swapU),
      swapUsedPct: swapT > 0 ? Math.round((swapU / swapT) * 100) : 0,
    };
  } catch { return null; }
}

// ─── File descriptors ─────────────────────────────────────────────────────────

function _readFdCount() {
  try {
    const raw = fs.readFileSync('/proc/sys/fs/file-nr', 'utf8');
    const p   = raw.trim().split(/\s+/).map(Number);
    return { allocated: p[0] || 0, free: p[1] || 0, max: p[2] || 0 };
  } catch { return null; }
}

// ─── Socket counts ────────────────────────────────────────────────────────────

function _readSockets() {
  try {
    const raw = fs.readFileSync('/proc/net/sockstat', 'utf8');
    const out = { tcp: 0, udp: 0, total: 0 };
    for (const line of raw.split('\n')) {
      const m1 = line.match(/^sockets:\s+used\s+(\d+)/);
      if (m1) out.total = parseInt(m1[1], 10);
      const m2 = line.match(/^TCP:\s+inuse\s+(\d+)/);
      if (m2) out.tcp   = parseInt(m2[1], 10);
      const m3 = line.match(/^UDP:\s+inuse\s+(\d+)/);
      if (m3) out.udp   = parseInt(m3[1], 10);
    }
    return out;
  } catch { return null; }
}

// ─── Uptime + boot time ───────────────────────────────────────────────────────

function _readSystemUptime() {
  try {
    const raw = fs.readFileSync('/proc/uptime', 'utf8');
    const sec = parseFloat(raw.split(/\s+/)[0]);
    return isFinite(sec) ? Math.round(sec) : null;
  } catch { return null; }
}

// ─── Top processes (/proc/[pid]/stat + status + comm) ─────────────────────────
//
// We compute %CPU per process by diffing utime+stime across scans.
// _procPrev maps pid → { ticks, cmd, rss } from previous scan.
// Cost: ~3 syscalls × N processes — at ~150 processes that's ~450 reads / scan.
// Throttled to 2 s so we don't burn CPU on the scanner itself.

let _procPrev    = new Map();
let _procPrevTime = 0;
let _topProcs    = { byCpu: [], byMem: [], totalProcs: 0, totalThreads: 0 };
let _clkTck      = 100; // jiffies per second on Linux (default; could read sysconf but rarely differs)
let _pageSize    = 4096;

function _scanProcesses() {
  const now = Date.now();
  const dt  = _procPrevTime === 0 ? FAST_MS / 1000 : (now - _procPrevTime) / 1000;
  _procPrevTime = now;
  const nextPrev = new Map();

  let pids;
  try { pids = fs.readdirSync('/proc'); } catch { return; }

  const all = [];
  let totalThreads = 0;

  for (const ent of pids) {
    if (!/^\d+$/.test(ent)) continue;
    const pid = parseInt(ent, 10);
    let statRaw, statusRaw;
    try { statRaw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { continue; }

    // Parse /proc/[pid]/stat — comm is in parens (may contain spaces/parens)
    const lp = statRaw.indexOf('(');
    const rp = statRaw.lastIndexOf(')');
    if (lp < 0 || rp < 0) continue;
    const comm = statRaw.slice(lp + 1, rp);
    const rest = statRaw.slice(rp + 2).split(' ');
    // rest[0]=state, rest[11]=utime, rest[12]=stime, rest[17]=num_threads, rest[21]=rss(pages)
    const state    = rest[0];
    const utime    = parseInt(rest[11], 10) || 0;
    const stime    = parseInt(rest[12], 10) || 0;
    const nthreads = parseInt(rest[17], 10) || 0;
    const rssPages = parseInt(rest[21], 10) || 0;
    const ticks    = utime + stime;
    const rssBytes = rssPages * _pageSize;

    totalThreads += nthreads;

    let cpuPct = 0;
    const prev = _procPrev.get(pid);
    if (prev) {
      const dtTicks = ticks - prev.ticks;
      cpuPct = dt > 0 ? Math.max(0, (dtTicks / _clkTck) / dt) * 100 : 0;
    }
    nextPrev.set(pid, { ticks });

    all.push({ pid, comm, state, cpuPct, rssMB: Math.round(rssBytes / 1048576) });
  }

  _procPrev = nextPrev;

  const byCpu = [...all].sort((a, b) => b.cpuPct - a.cpuPct).slice(0, TOP_N_CPU)
    .map(p => ({ ...p, cpuPct: +p.cpuPct.toFixed(1) }));
  const byMem = [...all].sort((a, b) => b.rssMB - a.rssMB).slice(0, TOP_N_MEM)
    .map(p => ({ ...p, cpuPct: +p.cpuPct.toFixed(1) }));

  _topProcs = { byCpu, byMem, totalProcs: all.length, totalThreads };
}

// ─── Ring buffer history ──────────────────────────────────────────────────────

const _history = [];

function _pushHistory(sample) {
  _history.push(sample);
  if (_history.length > HISTORY_SAMPLES) _history.shift();
}

function history() { return _history.slice(); }

// ─── Main tick ────────────────────────────────────────────────────────────────

let _latest = {
  psi: null, cores: null, net: null, disk: null, memBreakdown: null,
  fds: null, sockets: null, sysUptime: null, diskUsage: null, top: null,
};
let _fastTimer = null;
let _procTimer = null;

function _fastTick() {
  _sampleNet();
  _sampleDisk();
  const mem = readMemBreakdown();
  const cores = _sampleCoreCpu();
  const psi = readPsi();
  const fds = _readFdCount();
  const sockets = _readSockets();
  const sysUptime = _readSystemUptime();
  const diskUsage = _readDiskUsage();

  _latest = {
    psi, cores, net: _netRate, disk: _diskRate,
    memBreakdown: mem, fds, sockets, sysUptime, diskUsage,
    top: _topProcs,
  };

  // Append to history
  if (cores || mem) {
    const cpuAvg = cores && cores.length
      ? cores.reduce((s, x) => s + x, 0) / cores.length
      : null;
    const ramPct = mem && mem.totalMB > 0
      ? (mem.totalMB - mem.availableMB) / mem.totalMB
      : null;
    _pushHistory({
      ts:           Date.now(),
      cpu:          cpuAvg,
      ram:          ramPct,
      netRxBps:     _netRate?.rxBps    ?? 0,
      netTxBps:     _netRate?.txBps    ?? 0,
      diskReadBps:  _diskRate?.readBps  ?? 0,
      diskWriteBps: _diskRate?.writeBps ?? 0,
    });
  }
}

function start() {
  // Read CLK_TCK / page size once (Linux default 100 / 4096; sysconf via os module not available)
  try { _pageSize = require('os').constants?.UV_TTY_MODE_NORMAL ? 4096 : 4096; } catch {}

  _fastTick();
  _scanProcesses();

  _fastTimer = setInterval(_fastTick, FAST_MS);
  _procTimer = setInterval(_scanProcesses, PROC_SCAN_MS);
  if (_fastTimer.unref) _fastTimer.unref();
  if (_procTimer.unref) _procTimer.unref();

  console.log(`[systemMetrics] Started — fast=${FAST_MS}ms, procScan=${PROC_SCAN_MS}ms, history=${HISTORY_SAMPLES}`);
}

function stop() {
  if (_fastTimer) { clearInterval(_fastTimer); _fastTimer = null; }
  if (_procTimer) { clearInterval(_procTimer); _procTimer = null; }
}

function latest() { return _latest; }

module.exports = { start, stop, latest, history, readPsi };
