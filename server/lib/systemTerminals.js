'use strict';

const { execFile } = require('child_process');

// PIDs that are never killable
const PROTECTED_PIDS = new Set([1, process.pid]);

// Process names that are never killable
const PROTECTED_COMMS = new Set([
  'sshd', 'systemd', 'init', 'dbus-daemon', 'earlyoom',
  'systemd-journal', 'systemd-udevd', 'journald',
]);

/**
 * Returns all processes that have a pts/N or tty terminal.
 * Each entry: { pid, ppid, user, tty, stat, comm, args }
 */
function listPtsProcesses() {
  return new Promise((resolve) => {
    execFile(
      'ps', ['-e', '-o', 'pid=,ppid=,user=,tty=,stat=,comm=,args='],
      { timeout: 5000, maxBuffer: 512 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        const processes = [];
        for (const line of stdout.trim().split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Fixed-width columns: ps aligns them with spaces
          const parts = trimmed.split(/\s+/);
          if (parts.length < 6) continue;
          const pid  = parseInt(parts[0], 10);
          const ppid = parseInt(parts[1], 10);
          const user = parts[2];
          const tty  = parts[3];
          const stat = parts[4];
          const comm = parts[5];
          const args = parts.slice(6).join(' ');
          // Only include terminal-attached processes
          if (!tty || tty === '?' || (!tty.startsWith('pts/') && !tty.startsWith('tty'))) continue;
          if (isNaN(pid)) continue;
          processes.push({ pid, ppid, user, tty, stat, comm, args });
        }
        resolve(processes);
      }
    );
  });
}

/**
 * Sends a signal to a process. Refuses to kill protected PIDs/comms.
 * signal: 'SIGTERM' (default) or 'SIGKILL'
 */
function killSystemProcess(pid, signal = 'SIGTERM') {
  pid = parseInt(pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return Promise.reject(new Error('Invalid PID'));
  }
  if (PROTECTED_PIDS.has(pid)) {
    return Promise.reject(new Error(`PID ${pid} is protected and cannot be killed`));
  }
  if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
    return Promise.reject(new Error('Only SIGTERM and SIGKILL are allowed'));
  }
  return new Promise((resolve, reject) => {
    execFile('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 3000 }, (err, stdout) => {
      if (err) return reject(new Error('Process not found'));
      const comm = stdout.trim();
      if (PROTECTED_COMMS.has(comm)) {
        return reject(new Error(`Cannot kill protected process: ${comm}`));
      }
      try {
        process.kill(pid, signal);
        resolve({ ok: true, pid, signal });
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { listPtsProcesses, killSystemProcess };
