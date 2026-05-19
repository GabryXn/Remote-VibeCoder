export interface SessionMetadata {
  sessionId: string    // full tmux name: "claude-myrepo-ab1c2d"
  repo:      string | null
  label:     string
  mode:      'claude' | 'shell'
  workdir:   string
  created:   number    // ms timestamp
  windows:   number
}

export interface SystemSession {
  sessionId: string
  repo:      string | null
  label:     string
  mode:      string
  created:   number
  windows:   number
  attached:  boolean
  origin:    'vibecoder' | 'external'
}

export interface SystemProcess {
  pid:  number
  ppid: number
  user: string
  tty:  string
  stat: string
  comm: string
  args: string
}
