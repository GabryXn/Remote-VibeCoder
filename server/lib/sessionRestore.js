'use strict';

/**
 * sessionRestore — persists tmux session data to disk and recreates sessions on startup.
 *
 * Handles two scenarios:
 *   - Service restart (Node.js crash/OOM): sessions still live in tmux; reload metadata into sessionStore.
 *   - Server reboot: sessions are gone; recreate them with saved cwd + command.
 *
 * Manifest file: ~/.claude-mobile/session-restore.json
 */

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const os   = require('os');
const { execFile } = require('child_process');

const RESTORE_FILE = path.join(os.homedir(), '.claude-mobile', 'session-restore.json');

const ALLOWED_SHELLS = new Set([
  '/bin/bash', '/bin/sh', '/bin/zsh',
  '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish',
]);

let _manifest  = {};
let _saveTimer = null;

function _load() {
  try {
    const raw = fs.readFileSync(RESTORE_FILE, 'utf8');
    _manifest = JSON.parse(raw);
    const n = Object.keys(_manifest).length;
    if (n > 0) console.log(`[session-restore] Loaded ${n} saved sessions from disk`);
  } catch {
    _manifest = {};
  }
}

function _scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    try {
      await fsp.writeFile(RESTORE_FILE, JSON.stringify(_manifest, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[session-restore] Failed to save manifest:', err.message);
    }
  }, 200);
}

/**
 * Persist a session entry so it can be restored after restart/reboot.
 * @param {string} name - tmux session name
 * @param {{ repo, label, mode, cwd, created }} data
 */
function saveSession(name, data) {
  _manifest[name] = { name, ...data };
  _scheduleSave();
}

/**
 * Remove a session entry from the manifest (called on explicit kill).
 */
function removeSession(name) {
  if (!_manifest[name]) return;
  delete _manifest[name];
  _scheduleSave();
}

function _runTmux(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function _listTmuxNames() {
  try {
    const out = await _runTmux(['list-sessions', '-F', '#{session_name}']);
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Called once at server startup. Restores tmux sessions and metadata.
 *
 * @param {Function} setMetaFn - sessionStore.setSessionMeta
 * @param {Function} invalidateCacheFn - tmuxClient.invalidateSessionsCache
 */
async function restoreSessions(setMetaFn, invalidateCacheFn) {
  _load();
  const entries = Object.values(_manifest);
  if (entries.length === 0) return;

  const existing = await _listTmuxNames();
  let restored = 0;
  let skipped  = 0;

  for (const entry of entries) {
    // Always reload metadata into sessionStore (covers service-restart case where tmux is still up)
    setMetaFn(entry.name, {
      repo:    entry.repo    ?? null,
      label:   entry.label   ?? entry.name,
      mode:    entry.mode    ?? 'shell',
      created: entry.created ?? Date.now(),
    });

    if (existing.has(entry.name)) {
      skipped++;
      continue; // Session already running in tmux — nothing else to do
    }

    // Session is gone (reboot) — recreate it
    const cwd    = entry.cwd && fs.existsSync(entry.cwd) ? entry.cwd : os.homedir();
    const shell  = ALLOWED_SHELLS.has(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
    const cmd    = entry.mode === 'shell' ? shell : 'claude';

    try {
      await _runTmux(['new-session', '-d', '-s', entry.name, '-c', cwd, '-x', '220', '-y', '50', cmd]);
      console.log(`[session-restore] Recreated: ${entry.name} (${cmd} in ${cwd})`);
      restored++;
    } catch (err) {
      console.warn(`[session-restore] Could not recreate ${entry.name}: ${err.message}`);
    }
  }

  if (restored > 0) invalidateCacheFn();

  const total = entries.length;
  console.log(`[session-restore] Done — ${skipped}/${total} already running, ${restored}/${total} recreated`);
}

module.exports = { saveSession, removeSession, restoreSessions };
