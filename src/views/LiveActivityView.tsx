import { CheckCircle2, Clock3, LoaderCircle, PanelLeftClose, ScrollText, Trash2 } from 'lucide-react'
import { PanelFooterActions, PanelHeader, PanelHeaderActions, PanelHeaderButton } from '../components/shared/PanelHeader'
import { PanelScrollArea } from '../components/shared/PanelScrollArea'
import type { AgentActionLog } from './AgentActionsView'

interface LiveActivityViewProps {
  busy: boolean
  entries: AgentActionLog[]
  onClear(): void
  onClose(): void
}

export function LiveActivityView({ busy, entries, onClear, onClose }: LiveActivityViewProps) {
  return <>
    <PanelHeader action={<PanelHeaderActions>
      <PanelHeaderButton label="Close live logs" onClick={onClose}><PanelLeftClose size={16} /></PanelHeaderButton>
    </PanelHeaderActions>} eyebrow="LIVE" title="Activity log" />
    <PanelScrollArea className="live-log-content" label="Live activity content">
      <div className={`live-log-state ${busy ? 'is-busy' : ''}`}>
        {busy ? <LoaderCircle className="agent-context-wheel" size={17} /> : <ScrollText size={17} />}
        <span><strong>{busy ? 'SAM LAB is working' : 'Waiting for the next event'}</strong><small>Simple session timeline · newest first</small></span>
      </div>
      {entries.length ? <ol className="live-log-list">{entries.map((entry, index) => <li key={entry.id}>
        <span>{index === 0 && busy ? <LoaderCircle className="agent-context-wheel" size={12} /> : index === 0 ? <Clock3 size={12} /> : <CheckCircle2 size={12} />}</span>
        <div><strong>{entry.message}</strong><time>{new Date(entry.createdAt).toLocaleTimeString()}</time></div>
      </li>)}</ol> : <p className="empty-copy">Play the graph or change a setting to start the live timeline.</p>}
    </PanelScrollArea>
    <PanelFooterActions>
      <PanelHeaderButton className="panel-clear-button" disabled={!entries.length} label="Clear session log" onClick={onClear}><Trash2 size={15} /></PanelHeaderButton>
    </PanelFooterActions>
  </>
}
