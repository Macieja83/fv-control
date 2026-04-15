import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

const AUTO_REFRESH_KEY = 'fv-control:error130:auto-refreshed'

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error)
    const isReact130 = message.includes('Minified React error #130')
    if (!isReact130) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(AUTO_REFRESH_KEY) === '1') return
    window.sessionStorage.setItem(AUTO_REFRESH_KEY, '1')
    window.location.reload()
  }

  handleReload = () => {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(AUTO_REFRESH_KEY)
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="auth-splash" role="alert" aria-live="assertive">
        <p className="auth-splash__text">Wystąpił błąd renderowania interfejsu.</p>
        <button type="button" className="btn btn--primary" onClick={this.handleReload}>
          Odśwież aplikację
        </button>
      </div>
    )
  }
}
