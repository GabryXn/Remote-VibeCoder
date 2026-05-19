import { useState } from 'react'
import {
  useQuickCommands, QUICK_CMD_COLORS, getColorDef,
  type QuickCommand, type ColorKey,
} from '@/hooks/useQuickCommands'
import styles from './QuickCommandsPanel.module.css'

type View = 'grid' | 'manage' | 'edit'

interface Props {
  open:      boolean
  onClose:   () => void
  sendToWs:  (data: string) => void
}

const EMOJI_SUGGESTIONS = ['⚡', '🤖', '📋', '🔧', '🚀', '🐛', '📦', '🧪', '🔍', '💾', '🌿', '🏗']

const DEFAULT_FORM = { label: '', command: '', color: 'orange' as ColorKey, icon: '⚡' }

export function QuickCommandsPanel({ open, onClose, sendToWs }: Props) {
  const { commands, addCommand, updateCommand, deleteCommand } = useQuickCommands()
  const [view,    setView]    = useState<View>('grid')
  const [editing, setEditing] = useState<QuickCommand | null>(null)
  const [form,    setForm]    = useState(DEFAULT_FORM)

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close()
  }

  const close = () => { setView('grid'); setEditing(null); setForm(DEFAULT_FORM); onClose() }

  const openEdit = (cmd?: QuickCommand) => {
    if (cmd) {
      setEditing(cmd)
      setForm({ label: cmd.label, command: cmd.command, color: cmd.color, icon: cmd.icon })
    } else {
      setEditing(null)
      setForm(DEFAULT_FORM)
    }
    setView('edit')
  }

  const handleSave = () => {
    if (!form.label.trim() || !form.command.trim()) return
    if (editing) {
      updateCommand(editing.id, form)
    } else {
      addCommand(form)
    }
    setView('manage')
    setEditing(null)
    setForm(DEFAULT_FORM)
  }

  const handleDelete = (id: string) => {
    if (!confirm('Eliminare questo comando?')) return
    deleteCommand(id)
    if (view === 'edit') setView('manage')
  }

  const handleRun = (cmd: QuickCommand) => {
    sendToWs(cmd.command + '\r')
    close()
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.sheet}>
        <div className={styles.handle} />

        {/* ── GRID VIEW ─────────────────────────────────────────── */}
        {view === 'grid' && (
          <>
            <div className={styles.titleRow}>
              <span className={styles.title}>⚡ Comandi rapidi</span>
              <button className={styles.manageBtn} onClick={() => setView('manage')} title="Gestisci comandi">
                ✏
              </button>
            </div>

            {commands.length === 0 ? (
              <div className={styles.empty}>
                <span>Nessun comando configurato.</span>
                <button className={styles.addFirstBtn} onClick={() => openEdit()}>+ Aggiungi</button>
              </div>
            ) : (
              <div className={styles.grid}>
                {commands.map(cmd => {
                  const col = getColorDef(cmd.color)
                  return (
                    <button
                      key={cmd.id}
                      className={styles.cmdBtn}
                      style={{ background: col.bg, color: col.text }}
                      onClick={() => handleRun(cmd)}
                    >
                      <span className={styles.cmdIcon}>{cmd.icon}</span>
                      <span className={styles.cmdLabel}>{cmd.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── MANAGE VIEW ───────────────────────────────────────── */}
        {view === 'manage' && (
          <>
            <div className={styles.titleRow}>
              <button className={styles.backBtn} onClick={() => setView('grid')}>←</button>
              <span className={styles.title}>Gestisci comandi</span>
              <button className={styles.manageBtn} onClick={() => openEdit()} title="Nuovo comando">+</button>
            </div>

            {commands.length === 0 ? (
              <div className={styles.empty}>
                <span>Nessun comando. Crea il primo!</span>
              </div>
            ) : (
              <div className={styles.manageList}>
                {commands.map(cmd => {
                  const col = getColorDef(cmd.color)
                  return (
                    <div key={cmd.id} className={styles.manageRow}>
                      <span
                        className={styles.colorDot}
                        style={{ background: col.bg, color: col.text }}
                      >
                        {cmd.icon}
                      </span>
                      <div className={styles.manageInfo}>
                        <span className={styles.manageLabel}>{cmd.label}</span>
                        <span className={styles.manageCmd}>{cmd.command}</span>
                      </div>
                      <div className={styles.manageActions}>
                        <button className={styles.editRowBtn} onClick={() => openEdit(cmd)} title="Modifica">✏</button>
                        <button className={styles.deleteRowBtn} onClick={() => handleDelete(cmd.id)} title="Elimina">✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── EDIT VIEW ─────────────────────────────────────────── */}
        {view === 'edit' && (
          <>
            <div className={styles.titleRow}>
              <button className={styles.backBtn} onClick={() => setView('manage')}>←</button>
              <span className={styles.title}>{editing ? 'Modifica comando' : 'Nuovo comando'}</span>
            </div>

            <div className={styles.editForm}>
              <label className={styles.fieldLabel}>
                Etichetta
                <input
                  className={styles.fieldInput}
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="es. Claude, Git status…"
                  maxLength={30}
                />
              </label>

              <label className={styles.fieldLabel}>
                Comando
                <input
                  className={styles.fieldInput}
                  value={form.command}
                  onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                  placeholder="es. claude, git status"
                  autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                />
              </label>

              <div className={styles.fieldLabel}>
                Icona
                <div className={styles.emojiGrid}>
                  {EMOJI_SUGGESTIONS.map(e => (
                    <button
                      key={e}
                      className={[styles.emojiBtn, form.icon === e ? styles.emojiBtnActive : ''].filter(Boolean).join(' ')}
                      onClick={() => setForm(f => ({ ...f, icon: e }))}
                    >{e}</button>
                  ))}
                  <input
                    className={styles.emojiCustom}
                    value={form.icon}
                    onChange={ev => setForm(f => ({ ...f, icon: ev.target.value }))}
                    maxLength={4}
                    placeholder="?"
                    title="Emoji personalizzata"
                  />
                </div>
              </div>

              <div className={styles.fieldLabel}>
                Colore
                <div className={styles.colorGrid}>
                  {QUICK_CMD_COLORS.map(c => (
                    <button
                      key={c.key}
                      className={[styles.colorSwatch, form.color === c.key ? styles.colorSwatchActive : ''].filter(Boolean).join(' ')}
                      style={{ background: c.bg, color: c.text }}
                      onClick={() => setForm(f => ({ ...f, color: c.key as ColorKey }))}
                      title={c.label}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Anteprima:</span>
                <button
                  className={styles.cmdBtn}
                  style={{ background: getColorDef(form.color).bg, color: getColorDef(form.color).text, pointerEvents: 'none' }}
                >
                  <span className={styles.cmdIcon}>{form.icon || '?'}</span>
                  <span className={styles.cmdLabel}>{form.label || 'Etichetta'}</span>
                </button>
              </div>

              <div className={styles.editActions}>
                {editing && (
                  <button className={styles.deleteBtn} onClick={() => handleDelete(editing.id)}>
                    Elimina
                  </button>
                )}
                <button className={styles.cancelBtn} onClick={() => setView('manage')}>Annulla</button>
                <button
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={!form.label.trim() || !form.command.trim()}
                >
                  Salva
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
