import { useState, useCallback, useRef, useEffect } from 'react'
import type { SystemSession, SystemProcess } from '@/types/sessions'

const POLL_MS = 5000

export function useSystemTerminals(enabled: boolean) {
  const [sessions,  setSessions]  = useState<SystemSession[]>([])
  const [processes, setProcesses] = useState<SystemProcess[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSystem = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/system')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { sessions: SystemSession[]; processes: SystemProcess[] }
      setSessions(data.sessions)
      setProcesses(data.processes)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load system terminals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    setLoading(true)
    fetchSystem()
    timerRef.current = setInterval(fetchSystem, POLL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled, fetchSystem])

  const killTmuxSession = useCallback(async (name: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sessions/system/tmux/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setSessions(prev => prev.filter(s => s.sessionId !== name))
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to kill session')
      return false
    }
  }, [])

  const killProcess = useCallback(async (pid: number, force = false): Promise<boolean> => {
    const signal = force ? 'SIGKILL' : 'SIGTERM'
    try {
      const res = await fetch(
        `/api/sessions/system/process/${pid}?signal=${signal}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setProcesses(prev => prev.filter(p => p.pid !== pid))
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to kill process')
      return false
    }
  }, [])

  return {
    sessions, processes, loading, error,
    fetchSystem, killTmuxSession, killProcess,
  }
}
