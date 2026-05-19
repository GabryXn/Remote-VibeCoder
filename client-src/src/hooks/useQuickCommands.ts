import { useState, useCallback } from 'react'

export interface QuickCommand {
  id:      string
  label:   string
  command: string
  color:   ColorKey
  icon:    string
}

export const QUICK_CMD_COLORS = [
  { key: 'orange', bg: '#92400e', text: '#fbbf24', label: 'Arancione' },
  { key: 'blue',   bg: '#1e3a5f', text: '#60a5fa', label: 'Blu' },
  { key: 'green',  bg: '#14532d', text: '#4ade80', label: 'Verde' },
  { key: 'purple', bg: '#3b0764', text: '#c084fc', label: 'Viola' },
  { key: 'pink',   bg: '#500724', text: '#f472b6', label: 'Rosa' },
  { key: 'cyan',   bg: '#0c4a6e', text: '#22d3ee', label: 'Ciano' },
  { key: 'red',    bg: '#450a0a', text: '#f87171', label: 'Rosso' },
  { key: 'gray',   bg: '#27272a', text: '#a1a1aa', label: 'Grigio' },
] as const

export type ColorKey = typeof QUICK_CMD_COLORS[number]['key']

export function getColorDef(key: ColorKey) {
  return QUICK_CMD_COLORS.find(c => c.key === key) ?? QUICK_CMD_COLORS[0]
}

const STORAGE_KEY = 'vibecoder_quick_commands'

const DEFAULT_COMMANDS: QuickCommand[] = [
  { id: 'default-1', label: 'Claude', command: 'claude', color: 'orange', icon: '🤖' },
  { id: 'default-2', label: 'Git status', command: 'git status', color: 'blue', icon: '📋' },
]

function load(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_COMMANDS
    return JSON.parse(raw) as QuickCommand[]
  } catch {
    return DEFAULT_COMMANDS
  }
}

function persist(commands: QuickCommand[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands))
}

export function useQuickCommands() {
  const [commands, setCommands] = useState<QuickCommand[]>(load)

  const addCommand = useCallback((cmd: Omit<QuickCommand, 'id'>) => {
    setCommands(prev => {
      const next = [...prev, { ...cmd, id: Date.now().toString() }]
      persist(next)
      return next
    })
  }, [])

  const updateCommand = useCallback((id: string, updates: Partial<Omit<QuickCommand, 'id'>>) => {
    setCommands(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...updates } : c)
      persist(next)
      return next
    })
  }, [])

  const deleteCommand = useCallback((id: string) => {
    setCommands(prev => {
      const next = prev.filter(c => c.id !== id)
      persist(next)
      return next
    })
  }, [])

  return { commands, addCommand, updateCommand, deleteCommand }
}
