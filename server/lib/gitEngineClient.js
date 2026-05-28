'use strict';

/**
 * Wrapper Node.js per la CLI Python di gitengine (submodule condiviso).
 *
 * Ogni funzione spawna `python3 -m gitengine <comando>` con le credenziali
 * GIT_ASKPASS già impostate nell'ambiente quando necessario per le operazioni
 * autenticate (fetch, pull, push, clone).
 *
 * Il processo Python eredita GIT_ASKPASS e usa le credenziali per git senza
 * che il token venga mai scritto nella config di git o nell'URL remoto.
 */

const path      = require('path');
const { spawn } = require('child_process');
const fs        = require('fs');
const os        = require('os');
const crypto    = require('crypto');
const config    = require('../config');

// Root del progetto (due livelli sopra server/lib/)
const PROJECT_ROOT  = path.resolve(__dirname, '../..');
// La CLI Python viene eseguita come modulo dal parent di gitengine/
const GITENGINE_CWD = PROJECT_ROOT;

// ─── Core: esegui CLI gitengine ───────────────────────────────────────────────

/**
 * Esegue `python3 -m gitengine <args>` e ritorna il JSON parsato.
 * Rigetta con un Error arricchito di `.gitResult` se il comando fallisce.
 */
function runGitEngine(args, extraEnv = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const env  = { ...process.env, ...extraEnv };
    const proc = spawn('uv', ['run', '--', 'python3', '-m', 'gitengine', ...args], {
      cwd: GITENGINE_CWD,
      env,
    });

    let stdout = '';
    let stderr = '';
    let done   = false;

    const timer = setTimeout(() => {
      done = true;
      proc.kill('SIGTERM');
      reject(new Error(`gitengine timeout (${timeoutMs}ms): ${args.join(' ')}`));
    }, timeoutMs);

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      try {
        const result = JSON.parse(stdout.trim());
        if (code !== 0 && result.success === false) {
          const err     = new Error(result.message || `gitengine exit ${code}`);
          err.gitResult = result;
          return reject(err);
        }
        resolve(result);
      } catch (_) {
        reject(new Error(`gitengine JSON parse error (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      reject(new Error(`gitengine spawn error: ${err.message}`));
    });
  });
}

// ─── Credenziali temporanee GIT_ASKPASS ──────────────────────────────────────

function _makeCredentialEnv(token) {
  if (!token) throw new Error('GitHub PAT non configurato — aggiorna ~/.claude-mobile/config.json');
  const tmpDir     = path.join(os.tmpdir(), `vc-cred-${crypto.randomBytes(8).toString('hex')}`);
  const tokenFile  = path.join(tmpDir, 'token');
  const helperFile = path.join(tmpDir, 'askpass.sh');
  const ghUser     = config.get().githubUser || process.env.GITHUB_USER || 'x-access-token';

  fs.mkdirSync(tmpDir, { mode: 0o700 });
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  fs.writeFileSync(
    helperFile,
    `#!/bin/sh\ncase "$1" in *Username*) printf '%s' '${ghUser}';; *) cat "${tokenFile}";; esac\n`,
    { mode: 0o700 }
  );
  return {
    env:    { GIT_ASKPASS: helperFile, GIT_TERMINAL_PROMPT: '0' },
    tmpDir,
  };
}

function _cleanupCredentialEnv(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

async function _withCred(token, fn) {
  const { env, tmpDir } = _makeCredentialEnv(token);
  try {
    return await fn(env);
  } finally {
    _cleanupCredentialEnv(tmpDir);
  }
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/** Stato locale: branch, tracking, ahead/behind, file modificati, autore. */
async function getGitStatus(repoPath) {
  const result = await runGitEngine(['status', repoPath]);
  // Normalizza per compatibilità con il vecchio formato di gitOps.getGitStatus
  return {
    branch:      result.branch,
    tracking:    null,
    ahead:       result.ahead,
    behind:      result.behind,
    files:       [],
    authorName:  '',
    authorEmail: '',
    ...result,
  };
}

/** Fetch remoto + stato locale. */
async function getSyncStatus(repoPath, token) {
  return _withCred(token, async (credEnv) => {
    await runGitEngine(['fetch', repoPath], credEnv, 15000).catch(err =>
      console.warn('[gitEngineClient] fetch warning:', err.message)
    );
    const result = await runGitEngine(['status', repoPath]);
    return {
      synced:       result.state === 'synced',
      localChanges: result.dirty,
      ahead:        result.ahead,
      behind:       result.behind,
      branch:       result.branch,
      tracking:     null,
      files:        [],
    };
  });
}

async function cloneRepo(cloneUrl, destPath, token, _reposDir, timeoutMs = 60000) {
  return _withCred(token, credEnv =>
    runGitEngine(['clone', cloneUrl, destPath], credEnv, timeoutMs)
  );
}

async function pullRepo(repoPath, token) {
  return _withCred(token, credEnv =>
    runGitEngine(['pull', repoPath], credEnv)
  );
}

/** Pull con --rebase (gitengine usa già --rebase internamente). */
async function pullRepoRebase(repoPath, token) {
  return pullRepo(repoPath, token);
}

/** Fetch + reset --hard + clean: scarta tutto il lavoro locale. */
async function forcePull(repoPath, token) {
  return _withCred(token, credEnv =>
    runGitEngine(['force-pull', repoPath], credEnv)
  );
}

/**
 * Stage + commit (senza push).
 * Supporta GIT_AUTHOR_NAME/EMAIL via authorEnv per commit con autore personalizzato.
 * @returns {{ commit: string }}
 */
async function commitRepo(repoPath, { message, files, authorEnv }) {
  const args = ['commit', repoPath, '--message', message.trim()];
  if (files && files.length > 0 && !(files.length === 1 && files[0] === '.')) {
    args.push('--files', ...files);
  }
  if (authorEnv) {
    if (authorEnv.GIT_AUTHOR_NAME)  args.push('--author-name',  authorEnv.GIT_AUTHOR_NAME);
    if (authorEnv.GIT_AUTHOR_EMAIL) args.push('--author-email', authorEnv.GIT_AUTHOR_EMAIL);
  }
  const result = await runGitEngine(args);
  return { commit: result.commit || result.technical_detail || '' };
}

async function pushRepo(repoPath, token, _branch) {
  return _withCred(token, credEnv =>
    runGitEngine(['push', repoPath], credEnv)
  );
}

async function stripEmbeddedCredentials(_repoPath, _repoName) {
  // gitengine gestisce le credenziali via GIT_ASKPASS — non servono URL embedded
}

/**
 * Sincronizza tutti i submodule di `repoPath` applicando la macchina a stati
 * standard (BEHIND→pull, AHEAD→push, DIRTY→commit+push, DIVERGED→errore).
 *
 * Da chiamare PRIMA di pushare il parent quando si vuole garantire che i
 * workflow di deploy ricevano codice consistente (parent + submodule allineati
 * all'ultimo commit del rispettivo branch tracked).
 *
 * Se un submodule è DIVERGED, la chiamata fallisce e il parent NON va pushato.
 *
 * @param {string} repoPath     path assoluto del parent
 * @param {string} token        GitHub PAT (serve per fetch/push nei submodule)
 * @param {object} [opts]
 * @param {string} [opts.path]         path del singolo submodule (default: tutti)
 * @param {string} [opts.commitTitle]  titolo del commit per submodule dirty
 * @param {string} [opts.commitBody]   body del commit per submodule dirty
 */
async function syncSubmodules(repoPath, token, opts = {}) {
  const args = ['submodule-sync', repoPath];
  if (opts.path)        args.push('--path',         opts.path);
  if (opts.commitTitle) args.push('--commit-title', opts.commitTitle);
  if (opts.commitBody)  args.push('--commit-body',  opts.commitBody);
  return _withCred(token, credEnv => runGitEngine(args, credEnv, 120000));
}

/**
 * Stato dettagliato dei submodule (state, ahead/behind, pointer_drift, dirty).
 * Read-only — non modifica nulla.
 */
async function getSubmodulesStatus(repoPath) {
  return runGitEngine(['submodule-status', repoPath]);
}

/**
 * Push "submodule-safe": prima sincronizza tutti i submodule (che potrebbe
 * lasciare il parent dirty per il pointer bump), poi committa il bump se serve
 * e infine pusha il parent.
 *
 * @param {string} repoPath
 * @param {string} token
 * @param {object} [opts]
 * @param {string} [opts.commitTitle]  titolo per il commit di bump del parent
 * @param {string} [opts.commitBody]
 */
async function pushRepoSafe(repoPath, token, opts = {}) {
  await syncSubmodules(repoPath, token, {
    commitTitle: opts.commitTitle || 'chore: auto-sync submodule',
    commitBody:  opts.commitBody  || '',
  });
  return _withCred(token, async credEnv => {
    const status = await runGitEngine(['status', repoPath]);
    if (status.dirty) {
      const title = opts.commitTitle || 'chore: bump submodule pointer';
      await runGitEngine(
        ['commit-and-push', repoPath, '--title', title, '--body', opts.commitBody || ''],
        credEnv,
      );
      return { success: true, action: 'committed_and_pushed_bump' };
    }
    if (status.ahead > 0) {
      await runGitEngine(['push', repoPath], credEnv);
      return { success: true, action: 'pushed' };
    }
    return { success: true, action: 'noop' };
  });
}

function ensureReposDir(reposDir) {
  fs.mkdirSync(reposDir, { recursive: true });
}

module.exports = {
  runGitEngine,
  getGitStatus,
  getSyncStatus,
  cloneRepo,
  pullRepo,
  pullRepoRebase,
  forcePull,
  commitRepo,
  pushRepo,
  pushRepoSafe,
  syncSubmodules,
  getSubmodulesStatus,
  stripEmbeddedCredentials,
  ensureReposDir,
};
