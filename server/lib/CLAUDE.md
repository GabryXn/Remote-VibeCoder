# server/lib/ — Pure library modules

No Express imports. Each module has one responsibility and no cross-module state.

## Module responsibilities

### `procReader.js`
Reads `/proc/meminfo`, `/proc/loadavg`, `/proc/stat`. All functions are stateless and synchronous (except `getCpuUsage()` which diffs over 300ms). Graceful fallback to `os` module on non-Linux hosts. Only used by `resource-governor.js`.

### `streamingGuard.js`
CPU-based streaming state machine (`ok` → `warn` → `critical`). Created via `createStreamingGuard({ getThresholds, onCpuReading })` factory.

**Critical edge case — debounce:** The transition back to `'ok'` has a 3-second debounce to avoid oscillating at the CPU threshold boundary. During recovery, a fast poll (every 5s) runs independently from the main pressure poll (which might be 60s away at LOW pressure). The `onCpuReading` callback lets resource-governor keep `_stats.cpu` current during recovery.

**Do NOT** import this module directly in routes or pty.js — always go through `resource-governor`.

### `tmuxClient.js`
Thin subprocess wrapper around `tmux` CLI. Manages two TTL caches:
- Sessions list cache: 3s TTL — prevents subprocess storm when frontend polls `/api/sessions`
- Pane CWD cache: 5s TTL — `display-message` is expensive

`invalidateSessionsCache()` must be called after creating/deleting a tmux session so the next poll sees the change immediately.

`pruneDeadCwdEntries(activeNames)` is called by sessionStore during cleanup — do not call it from routes.

**Session name format:** `claude-{repo}-{6-char-hex}` for new sessions, `claude-{repo}` for legacy sessions. `parseSessionName()` handles both.

### `sessionStore.js`
In-memory `Map` of `{ repo, label, mode, created }` keyed by tmux session name. Cleanup runs every 5 minutes (and once at startup after 5s) to remove entries for dead sessions.

**Do NOT** access `_meta` directly — use `getSessionMeta/setSessionMeta/deleteSessionMeta`.

### `githubClient.js`
Octokit factory + GitHub repo list cache (2-min TTL). Call `invalidateReposCache()` after any operation that changes the repo list (clone, delete).

### `gitEngineClient.js`
Wrapper Node→Python per il submodule `gitengine/` (repo condivisa con `git-sync-kde`). Ogni funzione spawna `python3 -m gitengine <comando>` e riceve JSON su stdout. Sostituisce `gitOps.js` come fonte delle operazioni git.

**Pattern credenziali:** `_makeCredentialEnv(token)` crea un `tmpDir` 0o700 con `askpass.sh` e `token`, imposta `GIT_ASKPASS` nell'env del subprocess Python, poi `_cleanupCredentialEnv()` elimina tutto. Il PAT non appare mai negli argomenti né in `.git/config`. Le operazioni locali (`status`) non ricevono credenziali — solo fetch/pull/push/clone usano `_withCred()`.

**`commitRepo`:** Passa `--author-name` / `--author-email` come flag CLI a gitengine, che li converte in `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME` per il commit Python.

**API pubblica:** `getGitStatus`, `getSyncStatus`, `cloneRepo`, `pullRepo`, `pullRepoRebase`, `forcePull`, `commitRepo`, `pushRepo`, `stripEmbeddedCredentials` (no-op), `ensureReposDir`.

### `gitOps.js`
**Legacy — non più importato da `repos.js`.** Conservato per riferimento storico. Tutte le operazioni git sono migrate in `gitEngineClient.js`.

### `gitCredentials.js`
Creates a temp script (0o600) that echoes the PAT, sets `GIT_ASKPASS` to that path, runs the callback, then deletes the file. Il pattern è replicato inline in `gitEngineClient.js` per passare l'env al subprocess Python. Il PAT non appare mai in `.git/config` né negli argomenti del processo.

### `repoValidation.js`
Pure input validation — no side effects. `validateRepoName`, `validateRepoPath`, `validateNestedPath`, `validateCommitParams`. Always run these before any filesystem or git operation.

### `gpuMonitor.js`
Optional GPU usage reader (`nvidia-smi`). Returns `null` if no GPU present — used by `/api/health`. Non-fatal; catch all errors.
