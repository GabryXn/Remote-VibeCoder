import { useRef, useState, useCallback } from 'react'
import styles from './FileDropZone.module.css'

interface FileDropZoneProps {
  onFileSelect: (file: File) => void
  onClose:      () => void
  isUploading?: boolean
}

export function FileDropZone({ onFileSelect, onClose, isUploading }: FileDropZoneProps) {
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [hoverName, setHoverName]  = useState<string | null>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    setHoverName(null)
    const file = e.dataTransfer.files?.[0]
    if (file) { onFileSelect(file); onClose() }
  }, [onFileSelect, onClose])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
    const file = e.dataTransfer.items?.[0]
    if (file?.kind === 'file') setHoverName(file.getAsFile()?.name ?? null)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only trigger if leaving the drop zone itself, not a child element
    if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
      setHoverName(null)
    }
  }, [])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { onFileSelect(file); onClose() }
    e.target.value = ''
  }, [onFileSelect, onClose])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Allega file">
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Allega file</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Chiudi">×</button>
        </div>

        <div
          className={[styles.dropZone, isDragOver ? styles.dropZoneOver : ''].filter(Boolean).join(' ')}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isUploading ? (
            <>
              <div className={styles.spinnerIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40">
                  <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="28">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                  </circle>
                </svg>
              </div>
              <p className={styles.dropText}>Caricamento in corso…</p>
            </>
          ) : isDragOver ? (
            <>
              <div className={styles.dropIconOver}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="40" height="40">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              </div>
              <p className={styles.dropTextOver}>
                {hoverName ? `Rilascia "${hoverName}"` : 'Rilascia il file'}
              </p>
            </>
          ) : (
            <>
              <div className={styles.dropIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </div>
              <p className={styles.dropText}>Trascina un file qui</p>
              <p className={styles.dropHint}>Immagini, testo, PDF — max 10 MB</p>
            </>
          )}
        </div>

        {!isUploading && (
          <>
            <div className={styles.divider}><span>oppure</span></div>

            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
            <button
              className={styles.browseBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              Sfoglia file…
            </button>
          </>
        )}
      </div>
    </div>
  )
}
