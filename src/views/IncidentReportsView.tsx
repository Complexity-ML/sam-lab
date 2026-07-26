import { AlertTriangle, CheckCircle2, Clock3, FileWarning, PanelRightClose, Sparkles } from 'lucide-react'
import { PanelHeader } from '../components/shared/PanelHeader'
import { PanelScrollArea } from '../components/shared/PanelScrollArea'
import type { IncidentEvent, IncidentSummary } from '../domain/incidents'
import type { AgentProposal } from '../domain/pipeline'

interface IncidentReportsViewProps {
  events: IncidentEvent[]
  incidents: IncidentSummary[]
  onClose(): void
  onOpenProposal(): void
  onSelectCard(nodeId: string): void
  proposal?: AgentProposal
}

export function IncidentReportsView({ events, incidents, onClose, onOpenProposal, onSelectCard, proposal }: IncidentReportsViewProps) {
  const active = incidents.filter((incident) => incident.status !== 'resolved')
  const waiting = active.filter((incident) => incident.status === 'waiting-review')
  const resolved = incidents.filter((incident) => incident.status === 'resolved')
  return <>
    <PanelHeader action={<button aria-label="Close incident reports" className="panel-toggle" onClick={onClose} title="Close incident reports" type="button"><PanelRightClose size={16} /></button>} eyebrow="REPORTS" title="Incident reports" />
    <PanelScrollArea className="reports-panel-content" label="Incident reports content">
      <section className="reports-overview">
        <div><strong>{active.length}</strong><small>Unresolved</small></div>
        <div><strong>{waiting.length + (proposal ? 1 : 0)}</strong><small>Review</small></div>
        <div><strong>{resolved.length}</strong><small>Resolved</small></div>
      </section>

      {proposal && <button className="report-proposal" onClick={onOpenProposal} type="button"><Sparkles size={16} /><span><small>PROPOSED SOLUTION</small><strong>{proposal.title}</strong><p>{proposal.summary}</p></span></button>}

      <div className="reports-heading"><strong>Needs attention</strong><small>{active.length} unique incident{active.length === 1 ? '' : 's'}</small></div>
      {active.length ? <div className="reports-list">{active.map((incident) => <button className={`severity-${incident.severity} status-${incident.status}`} disabled={!incident.cardId} key={incident.incidentKey} onClick={() => incident.cardId && onSelectCard(incident.cardId)} type="button">
        <span>{incident.severity === 'critical' ? <AlertTriangle size={15} /> : <FileWarning size={15} />}</span>
        <div><strong>{incident.title}</strong><p>{incident.detail}</p><small>{incident.sourceSystem ? `${incident.sourceSystem} · ` : ''}{incident.status.replace('-', ' ')} · {incident.occurrenceCount} occurrence{incident.occurrenceCount === 1 ? '' : 's'} · {new Date(incident.updatedAt).toLocaleString()}</small></div>
      </button>)}</div> : <div className="reports-clear"><CheckCircle2 size={18} /><span><strong>No unresolved incident</strong><small>Incidents from connected catalogs, databases, APIs and streams will appear here.</small></span></div>}

      <div className="reports-heading"><strong>Recent report activity</strong><small>{events.length} event{events.length === 1 ? '' : 's'}</small></div>
      <ol className="report-events">{events.slice(0, 30).map((event) => <li key={event.id}><Clock3 size={12} /><span><strong>{event.title}</strong><small>{event.transition.replace('-', ' ')} · {new Date(event.createdAt).toLocaleTimeString()}</small></span></li>)}</ol>
    </PanelScrollArea>
  </>
}
