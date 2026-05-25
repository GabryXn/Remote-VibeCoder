import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import type { TermInstance } from '@/terminal/constants'
import styles from './TerminalToolbar.module.css'

interface TerminalToolbarProps {
  sendToWs:        (data: string) => void
  activeInst:      TermInstance | undefined
  isHoldingSpace:  boolean
  toggleSpaceHold: () => void
  stopSpaceHold:   () => void
  onKill:          () => void
  onAttachFile:    (file: File) => void
  isUploading?:    boolean
}

export function TerminalToolbar({
  sendToWs, activeInst, isHoldingSpace, toggleSpaceHold, stopSpaceHold, onKill,
  onAttachFile, isUploading,
}: TerminalToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={styles.toolbar}>
      {/* Scrollable section — all buttons except Kill */}
      <div className={styles.toolbarScrollable}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = e.target.files
            if (files && files.length > 0) {
              Array.from(files).forEach(f => onAttachFile(f))
              e.target.value = ''
            }
          }}
        />

        {/* Group 1: control keys + attach */}
        <Button variant="toolbar" className={styles.tbEnter} onClick={() => sendToWs('\r')}>↵</Button>

        {/* Attach file button — seconda posizione, sempre visibile */}
        <button
          className={[styles.micBtn, isUploading ? styles.micBtnUploading : ''].filter(Boolean).join(' ')}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Allega file"
          aria-label="Allega file"
        >
          {isUploading ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="28">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </circle>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          )}
        </button>

        <Button variant="toolbar" onClick={() => sendToWs('\x03')}>^C</Button>
        <Button variant="toolbar" onClick={() => sendToWs('\t')}>Tab</Button>
        <Button variant="toolbar" onClick={() => sendToWs('\x1b')}>Esc</Button>

        <span className={styles.tbSep} />

        {/* Group 2: arrow keys */}
        <Button variant="toolbar" onClick={() => sendToWs('\x1b[A')}>↑</Button>
        <Button variant="toolbar" onClick={() => sendToWs('\x1b[B')}>↓</Button>
        <Button variant="toolbar" onClick={() => sendToWs('\x1b[D')}>←</Button>
        <Button variant="toolbar" onClick={() => sendToWs('\x1b[C')}>→</Button>

        <span className={styles.tbSep} />

        {/* Group 3: scroll + mic */}
        <Button variant="toolbar" onClick={() => activeInst?.term.scrollToBottom()}>⬇</Button>
        <Button variant="toolbar"
          onClick={() => {
            const ws = activeInst?.ws
            if (ws?.readyState === WebSocket.OPEN && activeInst) {
              ws.send(JSON.stringify({ type: 'resize', cols: activeInst.term.cols, rows: activeInst.term.rows }))
            }
          }}>↺</Button>

        <button
          className={[styles.micBtn, isHoldingSpace ? styles.micBtnRecording : ''].filter(Boolean).join(' ')}
          onTouchEnd={e => { e.preventDefault(); toggleSpaceHold() }}
          onTouchCancel={stopSpaceHold}
          onClick={toggleSpaceHold}
          title="Tap to toggle voice (Space hold)"
        >
          {isHoldingSpace ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-1 18.93V21h2v-1.07A8 8 0 0 0 20 12h-2a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93z"/></svg>
          )}
        </button>

        {isHoldingSpace && (
          <div className={styles.voiceListening}>
            <span className={styles.voiceListeningDot} />
            Tieni premuto per dettare…
          </div>
        )}
      </div>

      {/* Fixed-right Kill — always visible, never scrolls */}
      <div className={styles.toolbarKill}>
        <Button
          variant="toolbar"
          onClick={onKill}
          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
        >Kill</Button>
      </div>
    </div>
  )
}
