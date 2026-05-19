import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', _error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100dvh', gap: 16, padding: 24,
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Errore applicazione</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 400 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.replace('/projects')}
            style={{
              marginTop: 8, padding: '8px 20px', background: 'var(--accent-orange)',
              color: '#fff', border: 'none', borderRadius: 6,
              fontFamily: 'var(--font-mono)', fontSize: 13, cursor: 'pointer',
            }}
          >
            Torna alla dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
