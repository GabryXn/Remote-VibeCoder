import { useState } from 'react'
import type { SessionMetadata, SystemSession, SystemProcess } from '@/types/sessions'
import { useSystemTerminals } from '@/hooks/useSystemTerminals'
import styles from './TerminalSidebar.module.css'

interface TerminalSidebarProps {
  open:            boolean
  sessions:        SessionMetadata[]
  activeSessionId: string | null
  onSwitch:        (sessionId: string) => void
  onClose:         (sessionId: string) => void
  onAttach:        (sessionId: string) => void
  onDismiss:       () => void
}

type Tab = 'sessions' | 'system'

function activityLabel(created: number): string {
  const ago = Math.floor((Date.now() - created) / 60000)
  if (ago < 1)  return 'just now'
  if (ago < 60) return `${ago}m ago`
  return `${Math.floor(ago / 60)}h ago`
}

function SessionsList({
  sessions, activeSessionId, onSwitch, onClose,
}: Pick<TerminalSidebarProps, 'sessions' | 'activeSessionId' | 'onSwitch' | 'onClose'>) {
  return (
    <div className={styles.list}>
      {sessions.length === 0 && (
        <div className={styles.empty}>No open terminals</div>
      )}
      {sessions.map(s => (
        <div
          key={s.sessionId}
          className={[styles.item, s.sessionId === activeSessionId ? styles.itemActive : ''].filter(Boolean).join(' ')}
          onClick={() => onSwitch(s.sessionId)}
        >
          <div className={styles.itemMain}>
            <span className={styles.itemLabel}>{s.label}</span>
            <span className={styles.itemMeta}>
              {s.repo && <span className={styles.tag}>{s.repo}</span>}
              {s.mode === 'shell' && <span className={styles.tagShell}>shell</span>}
            </span>
            {s.workdir && (
              <span className={styles.itemDir} title={s.workdir}>
                {s.workdir.replace(/^\/home\/[^/]+\/repos\/[^/]+/, '~')}
              </span>
            )}
            <span className={styles.itemTime}>{activityLabel(s.created)}</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={e => { e.stopPropagation(); onClose(s.sessionId) }}
            title="Close terminal"
          >✕</button>
        </div>
      ))}
    </div>
  )
}

function SystemTmuxRow({
  s, onKill, onAttach,
}: { s: SystemSession; onKill: (name: string) => void; onAttach: (name: string) => void }) {
  return (
    <div className={styles.sysItem}>
      <div className={styles.itemMain}>
        <span className={styles.itemLabel}>{s.label}</span>
        <span className={styles.itemMeta}>
          {s.origin === 'external' && <span className={styles.tagExternal}>external</span>}
          {s.origin === 'vibecoder' && <span className={styles.tagVC}>vc</span>}
          {s.attached && <span className={styles.tagAttached}>attached</span>}
        </span>
        <span className={styles.itemTime}>{activityLabel(s.created)}</span>
      </div>
      <div className={styles.sysActions}>
        {s.origin === 'external' && (
          <button
            className={styles.attachBtn}
            onClick={() => onAttach(s.sessionId)}
            title="Attach in VibeCoder"
          >↗</button>
        )}
        <button
          className={styles.killBtn}
          onClick={() => onKill(s.sessionId)}
          title="Kill session"
        >✕</button>
      </div>
    </div>
  )
}

function SystemProcessRow({
  p, onKill,
}: { p: SystemProcess; onKill: (pid: number, force: boolean) => void }) {
  return (
    <div className={styles.sysItem}>
      <div className={styles.itemMain}>
        <span className={styles.itemLabel}>{p.comm}</span>
        <span className={styles.itemMeta}>
          <span className={styles.tagShell}>{p.tty}</span>
          <span className={styles.pidTag}>PID {p.pid}</span>
        </span>
        <span className={styles.itemDir} title={p.args}>{p.args.slice(0, 60)}</span>
      </div>
      <div className={styles.sysActions}>
        <button
          className={styles.killBtn}
          onClick={() => onKill(p.pid, false)}
          title="SIGTERM"
        >✕</button>
        <button
          className={[styles.killBtn, styles.killBtnForce].join(' ')}
          onClick={() => onKill(p.pid, true)}
          title="SIGKILL (force)"
        >☠</button>
      </div>
    </div>
  )
}

function SystemList({
  onAttach,
}: { onAttach: (sessionId: string) => void }) {
  const { sessions, processes, loading, error, killTmuxSession, killProcess } = useSystemTerminals(true)

  const handleKillSession = async (name: string) => {
    if (!confirm(`Kill tmux session "${name}"?`)) return
    await killTmuxSession(name)
  }

  const handleKillProcess = async (pid: number, force: boolean) => {
    if (!confirm(`${force ? 'Force kill' : 'Kill'} PID ${pid}?`)) return
    await killProcess(pid, force)
  }

  if (loading && sessions.length === 0 && processes.length === 0) {
    return <div className={styles.empty}>Loading…</div>
  }

  if (error) {
    return <div className={styles.sysError}>{error}</div>
  }

  return (
    <div className={styles.list}>
      {sessions.length > 0 && (
        <>
          <div className={styles.sysSection}>tmux sessions</div>
          {sessions.map(s => (
            <SystemTmuxRow
              key={s.sessionId}
              s={s}
              onKill={handleKillSession}
              onAttach={onAttach}
            />
          ))}
        </>
      )}
      {processes.length > 0 && (
        <>
          <div className={styles.sysSection}>terminal processes</div>
          {processes.map(p => (
            <SystemProcessRow key={p.pid} p={p} onKill={handleKillProcess} />
          ))}
        </>
      )}
      {sessions.length === 0 && processes.length === 0 && (
        <div className={styles.empty}>No active terminals</div>
      )}
    </div>
  )
}

export function TerminalSidebar({
  open, sessions, activeSessionId, onSwitch, onClose, onAttach, onDismiss,
}: TerminalSidebarProps) {
  const [tab, setTab] = useState<Tab>('sessions')

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onDismiss} />}
      <aside className={[styles.sidebar, open ? styles.sidebarOpen : ''].filter(Boolean).join(' ')}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={[styles.tabBtn, tab === 'sessions' ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('sessions')}
            >Sessions</button>
            <button
              className={[styles.tabBtn, tab === 'system' ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('system')}
            >System</button>
          </div>
          <button className={styles.dismissBtn} onClick={onDismiss}>✕</button>
        </div>

        {tab === 'sessions'
          ? <SessionsList sessions={sessions} activeSessionId={activeSessionId} onSwitch={onSwitch} onClose={onClose} />
          : <SystemList onAttach={onAttach} />
        }
      </aside>
    </>
  )
}
