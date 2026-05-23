import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Toggle-based space-hold for Claude Code's voice-input mode.
 * Tap once → start sending spaces (voice ON).
 * Tap again → stop (voice OFF / submit).
 *
 * The repeat starts immediately with no initial delay so Claude Code detects
 * the hold from the very first burst of spaces. A 400 ms gap between the first
 * space and the first repeat caused Claude Code to commit the initial space as a
 * regular character before the hold was recognised.
 */
export function useSpaceHold(sendToWs: (data: string) => void) {
  const [isHoldingSpace, setIsHoldingSpace] = useState(false)
  const spaceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopSpaceHold = useCallback(() => {
    if (spaceIntervalRef.current) {
      clearInterval(spaceIntervalRef.current)
      spaceIntervalRef.current = null
    }
    setIsHoldingSpace(false)
  }, [])

  const toggleSpaceHold = useCallback(() => {
    if (spaceIntervalRef.current) {
      stopSpaceHold()
      return
    }
    setIsHoldingSpace(true)
    sendToWs(' ')
    // Repeat immediately — no initial delay — so Claude Code sees a rapid
    // stream of spaces and registers a held key, not a single press.
    spaceIntervalRef.current = setInterval(() => sendToWs(' '), 30)
  }, [sendToWs, stopSpaceHold])

  useEffect(() => {
    return () => {
      if (spaceIntervalRef.current) clearInterval(spaceIntervalRef.current)
    }
  }, [])

  return { isHoldingSpace, toggleSpaceHold, stopSpaceHold }
}
