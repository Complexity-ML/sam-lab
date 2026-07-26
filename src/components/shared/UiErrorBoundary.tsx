import { AlertTriangle, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordDiagnostic } from '../../domain/diagnostics'
import { errorMessage } from '../../domain/toasts'

interface UiErrorBoundaryState { error?: Error }

export class UiErrorBoundary extends Component<{ children: ReactNode }, UiErrorBoundaryState> {
  state: UiErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): UiErrorBoundaryState { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic({ category: 'renderer', action: 'render.failure', status: 'error', detail: { message: error.message, componentStack: info.componentStack } })
  }

  private retry = () => this.setState({ error: undefined })

  render() {
    if (!this.state.error) return this.props.children
    return <main className="application-recovery" role="alert">
      <section>
        <span><AlertTriangle size={25} /></span>
        <small>RECOVERABLE INTERFACE ERROR</small>
        <h1>SAM LAB kept your last safe workspace</h1>
        <p>The renderer stopped unexpectedly. SQLite was not replaced, and no empty or failed agent run was marked successful.</p>
        <code>{errorMessage(this.state.error, 'The interface stopped unexpectedly')}</code>
        <div>
          <button onClick={this.retry} type="button"><RefreshCw size={16} />Retry interface</button>
          <button onClick={() => void window.dataLab?.openDiagnosticLogs()} type="button"><FolderOpen size={16} />Open local logs</button>
          <button className="primary" onClick={() => void window.dataLab?.restartApplication()} type="button"><RotateCcw size={16} />Restart SAM LAB</button>
        </div>
      </section>
    </main>
  }
}
