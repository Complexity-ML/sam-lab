import { CheckCircle2, Clock3, LoaderCircle, PanelLeftClose, Pause, Play, Square, Trash2 } from 'lucide-react'
import { PanelFooterActions, PanelHeader, PanelHeaderActions, PanelHeaderButton } from '../components/shared/PanelHeader'
import { PanelScrollArea } from '../components/shared/PanelScrollArea'
import type { AgentPlayerState } from '../components/AppHeader'

export interface AgentActionLog {
  id: string
  message: string
  createdAt: string
}

interface AgentActionsViewProps {
  busy: boolean
  history: AgentActionLog[]
  onClear(): void
  onClose(): void
  playerState: AgentPlayerState
}

export function AgentActionsView({ busy, history, onClear, onClose, playerState }: AgentActionsViewProps) {
  const StateIcon = playerState === 'running' ? Play : playerState === 'paused' ? Pause : Square
  return <>
    <PanelHeader action={<PanelHeaderActions>
      <PanelHeaderButton label="Close agent actions" onClick={onClose}><PanelLeftClose size={16} /></PanelHeaderButton>
    </PanelHeaderActions>} eyebrow="ACT" title="Agent actions" />
    <PanelScrollArea className="actions-panel-content" label="Agent actions content">
      <section className={`action-current ${busy ? 'is-busy' : ''}`}>
        <span>{busy ? <LoaderCircle className="agent-context-wheel" size={18} /> : <StateIcon size={18} />}</span>
        <div><small>CURRENT STATE</small><strong>{busy ? 'Agent iteration in progress' : `Player ${playerState}`}</strong><p>{history[0]?.message ?? 'No agent action recorded yet.'}</p></div>
      </section>
      <div className="action-history-heading"><strong>Action timeline</strong><small>{history.length} step{history.length === 1 ? '' : 's'}</small></div>
      {history.length ? <ol className="action-history">{history.map((entry, index) => <li key={entry.id}>
        <span>{index === 0 && busy ? <LoaderCircle className="agent-context-wheel" size={13} /> : index === 0 ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}</span>
        <div><strong>{entry.message}</strong><small>{new Date(entry.createdAt).toLocaleTimeString()}</small></div>
      </li>)}</ol> : <p className="empty-copy">Play the autonomous agent to record its graph iterations here.</p>}
    </PanelScrollArea>
    <PanelFooterActions>
      <PanelHeaderButton className="panel-clear-button" disabled={!history.length} label="Clear action timeline" onClick={onClear}><Trash2 size={15} /></PanelHeaderButton>
    </PanelFooterActions>
  </>
}
