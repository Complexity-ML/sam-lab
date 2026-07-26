import { AlertTriangle, BellRing, Check, CheckCircle2, Clock3, Database, GitBranch, RotateCcw, Square, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resolveVersionSelection } from '../../domain/versioning'
import type { DataHubEvidence } from '../../domain/datahub'
import { ActionButton } from './ActionButton'

export interface VersionSummary {
  id: string
  label: string
  createdAt: string
  origin: 'initial' | 'agent' | 'manual'
  blockingIssues: number
  status?: 'committed' | 'pending-review' | 'rejected'
  description?: string
  evidence?: DataHubEvidence[]
}

interface VersionBrowserProps {
  onApprove(versionId: string): void
  onEmergencyStop(): void
  onReject(versionId: string): void
  onRemind(version: VersionSummary): void
  onRestore(versionId: string): void
  pipelineTitle: string
  selectedVersionId?: string
  versions: VersionSummary[]
}

export function VersionBrowser({ onApprove, onEmergencyStop, onReject, onRemind, onRestore, pipelineTitle, selectedVersionId, versions }: VersionBrowserProps) {
  const preferredId = resolveVersionSelection(versions, selectedVersionId)
  const [selectedId, setSelectedId] = useState(preferredId)
  useEffect(() => { if (preferredId) setSelectedId(preferredId) }, [preferredId])
  const selected = versions.find((version) => version.id === selectedId) ?? versions.find((version) => version.id === preferredId)

  if (!selected) return <div className="version-browser-empty"><GitBranch size={24} /><strong>No version yet</strong><p>Save a checkpoint or ask the agent to propose an improvement.</p></div>
  const status = selected.status ?? 'committed'
  const pending = [...versions].reverse().filter((version) => version.status === 'pending-review')

  return <div className="version-browser">
    <aside aria-label="Pipeline versions" className="version-browser-sidebar">
      <header><strong>Human Review inbox</strong><small>{pending.length} pending · {pipelineTitle}</small></header>
      {pending.length > 0 && <ol className="review-inbox-list">{pending.map((version) => <li key={`review-${version.id}`}><button aria-current={version.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(version.id)} type="button"><span className="version-dot version-dot-pending-review" /><div><strong>{version.label}</strong><small>{version.description ?? 'Agent review requested'} · {new Date(version.createdAt).toLocaleString()}</small></div><em>pending</em></button></li>)}</ol>}
      <header className="all-versions-heading"><strong>All versions</strong><small>{versions.length} revisions</small></header>
      <ol>{[...versions].reverse().map((version) => <li key={version.id}><button aria-current={version.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(version.id)} type="button"><span className={`version-dot version-dot-${version.status ?? 'committed'}`} /> <div><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></div><em>{version.status === 'pending-review' ? 'review' : version.status === 'rejected' ? 'rejected' : version.origin}</em></button></li>)}</ol>
    </aside>
    <article className="version-browser-detail">
      <header><span className={`version-status status-${status}`}>{status === 'pending-review' ? <Clock3 size={14} /> : status === 'rejected' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}{status.replace('-', ' ')}</span><time>{new Date(selected.createdAt).toLocaleString()}</time></header>
      <small>REVISION COMMENT</small>
      <h4>{selected.label}</h4>
      <p>{selected.description ?? 'Manual pipeline checkpoint. No agent comment was attached to this revision.'}</p>
      <dl><div><dt>Origin</dt><dd>{selected.origin}</dd></div><div><dt>Atomic validation</dt><dd className={selected.blockingIssues ? 'has-errors' : ''}>{selected.blockingIssues ? <><AlertTriangle size={13} />{selected.blockingIssues} blocking issue(s)</> : <><CheckCircle2 size={13} />Checks passed</>}</dd></div><div><dt>Branch state</dt><dd>{status === 'pending-review' ? 'Paused until the named human decides' : status === 'rejected' ? 'Stopped — active graph was not changed' : 'Committed and restorable'}</dd></div></dl>
      <section className="version-evidence"><h5><Database size={13} />DataHub evidence provenance</h5>{selected.evidence?.length ? <ol>{selected.evidence.map((item, index) => <li className={item.stale || item.status !== 'ok' ? 'is-stale' : ''} key={`${item.tool}-${item.urn}-${index}`}><span><strong>{item.tool}</strong><em>{item.cached ? 'cache' : 'live'} · {item.status}</em></span><code>{item.urn}</code><p>{item.summary}</p><small>Captured {new Date(item.capturedAt).toLocaleString()} · {item.stale ? 'stale/unavailable' : `valid until ${new Date(item.expiresAt).toLocaleTimeString()}`}</small></li>)}</ol> : <p>No DataHub evidence was attached to this revision.</p>}</section>
      <div className="version-browser-actions">{status === 'pending-review' ? <>
        <ActionButton icon={<BellRing size={14} />} onClick={() => onRemind(selected)} variant="ghost">Remind</ActionButton>
        <ActionButton icon={<Square size={14} />} onClick={onEmergencyStop} variant="ghost">Emergency stop</ActionButton>
        <ActionButton icon={<X size={14} />} onClick={() => onReject(selected.id)} variant="secondary">Reject</ActionButton>
        <ActionButton disabled={selected.blockingIssues > 0} icon={<Check size={14} />} onClick={() => onApprove(selected.id)} variant="primary">Approve</ActionButton>
      </> : <ActionButton disabled={status !== 'committed'} icon={<RotateCcw size={14} />} onClick={() => onRestore(selected.id)} variant="primary">{status === 'rejected' ? 'Revision rejected' : 'Restore this version'}</ActionButton>}</div>
    </article>
  </div>
}
