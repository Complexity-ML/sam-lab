import { Check, DatabaseZap, GitCompareArrows, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentProposal } from '../domain/pipeline'
import { ActionButton } from './shared/ActionButton'
import { AgentPrompt } from './shared/AgentPrompt'

export interface ReviewAssistantProps {
  activity: string
  answer?: { summary: string; rationale: string; evidence: string[]; model: string }
  busy: boolean
  connected: boolean
  context: { ai?: string; cards: number; edges: number; versions: number; mcp: string; model: string }
  onAsk(question: string): void
  onOpenSettings(): void
  onStop(): void
}

interface ReviewPanelProps {
  assistant?: ReviewAssistantProps
  applying?: boolean
  proposal: AgentProposal
  relatedAssets: string[]
  revisionId?: string
  writebackAvailable: boolean
  onApply(writebackRequested: boolean): void
  onDiscard(): void
  onClose(): void
}

export function ReviewPanel({ applying = false, assistant, proposal, relatedAssets, revisionId, writebackAvailable, onApply, onClose, onDiscard }: ReviewPanelProps) {
  const [writebackRequested, setWritebackRequested] = useState(false)
  useEffect(() => setWritebackRequested(false), [proposal.title, revisionId])

  return <section className="review-panel">
    <div className="review-heading">
      <span><Sparkles size={16} /></span>
      <div><small>AGENT PROPOSAL</small><h2 id="proposal-review-title">{proposal.title}</h2></div>
      <button aria-label="Close proposal review" className="panel-toggle review-close" onClick={onClose} title="Close proposal review" type="button"><X size={16} /></button>
    </div>

    <p className="review-summary">{proposal.summary}</p>
    {(proposal.model || proposal.confidence !== undefined) && <div className="review-agent-meta"><span>{proposal.model ?? 'Connected model'}</span>{proposal.confidence !== undefined && <span>{Math.round(proposal.confidence * 100)}% confidence</span>}<span>{proposal.requiresHumanReview ? 'Human Review path' : 'Agent Decision path'}</span></div>}
    <div className="review-rationale"><ShieldCheck size={17} /><p>{proposal.rationale}</p></div>

    {assistant && <section className="review-assistant">
      <header><Sparkles size={15} /><div><strong>Human Review assistant</strong><small>Read-only · cannot approve, reject, mutate or write back</small></div></header>
      {assistant.answer && <div aria-live="polite" className="review-assistant-answer">
        <strong>{assistant.answer.model}</strong>
        <p>{assistant.answer.summary}</p>
        <small>{assistant.answer.rationale}</small>
        {assistant.answer.evidence.length > 0 && <ul>{assistant.answer.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
      </div>}
      <AgentPrompt
        activity={assistant.activity}
        agentLabel="Review assistant"
        ariaLabel="Ask the Human Review assistant"
        busy={assistant.busy}
        connected={assistant.connected}
        context={assistant.context}
        onOpenSettings={assistant.onOpenSettings}
        onStop={assistant.onStop}
        onSubmit={assistant.onAsk}
        placeholder="Ask why this change is needed, what evidence is missing, its impact, or a safer alternative…"
        submitLabel="Ask the Human Review assistant"
      />
    </section>}

    <div className="review-body-grid">
      <div className="review-body-column">
        {proposal.runTrace?.length ? <section className="review-section run-trace">
          <h3><Sparkles size={15} /> Agent card run</h3>
          <ol>{proposal.runTrace.map((step, index) => <li className={`trace-${step.state}`} key={`${step.nodeId}-${index}`}><span>{index + 1}</span><div><strong>{step.label}</strong><small>{step.role} · {step.summary}</small></div></li>)}</ol>
        </section> : null}

        {proposal.toolTrace?.length ? <section className="review-section run-trace agent-tool-trace">
          <h3><Sparkles size={15} /> Agent tools</h3>
          <ol>{proposal.toolTrace.map((step, index) => <li className={`trace-${step.status === 'rejected' ? 'failed' : 'completed'}`} key={`${step.tool}-${index}`}><span>{index + 1}</span><div><strong>{step.tool}</strong><small>{step.status} · {step.summary}</small></div></li>)}</ol>
        </section> : null}

        <section className="review-section">
          <h3><DatabaseZap size={15} /> Connector evidence read</h3>
          <ol>{proposal.datahubReads.map((item) => <li key={item}><code>{item}</code></li>)}</ol>
        </section>
      </div>

      <div className="review-body-column">
        <section className="review-section">
          <h3><GitCompareArrows size={15} /> Proposed graph diff</h3>
          {proposal.addedNodes.map((node) => <div className="diff-row diff-add" key={node.id}><span>+</span><div><strong>{node.data.label}</strong><small>{node.data.rule}</small></div></div>)}
          {proposal.updatedNodes.map((update) => <div className="diff-row diff-edit" key={update.nodeId}><span>~</span><div><strong>Edit {update.nodeId}</strong><small>{update.reason}</small></div></div>)}
          {proposal.removedEdgeIds.map((edgeId) => <div className="diff-row diff-remove" key={edgeId}><span>−</span><div><strong>Replace connection</strong><small>{edgeId}</small></div></div>)}
          {proposal.addedEdges.map((edge) => <div className="diff-row diff-add" key={edge.id}><span>+</span><div><strong>Connect cards</strong><small>{edge.source} → {edge.target}</small></div></div>)}
        </section>

        <section className="writeback-note">
          <h3>Local commit</h3>
          <p>{proposal.writeback}</p>
        </section>

        <section className="review-section datahub-writeback-review">
          <h3><DatabaseZap size={15} /> Optional DataHub write-back</h3>
          {writebackAvailable && revisionId ? <>
            <label className="writeback-approval-toggle">
              <input checked={writebackRequested} onChange={(event) => setWritebackRequested(event.target.checked)} type="checkbox" />
              <span><strong>Also publish this approved Decision to DataHub</strong><small>This is an external mutation and is never selected automatically.</small></span>
            </label>
            {writebackRequested && <div className="writeback-mutation-preview" role="region" aria-label="DataHub mutation preview">
              <strong>Exact mutation preview</strong>
              <dl>
                <div><dt>Operation</dt><dd><code>Governed DataHub Decision write-back</code></dd></div>
                <div><dt>Type</dt><dd><code>Decision</code></dd></div>
                <div><dt>Title</dt><dd>SAM LAB · {proposal.title}</dd></div>
                <div><dt>Revision</dt><dd><code>{revisionId}</code></dd></div>
                <div><dt>Author</dt><dd>SAM LAB operator</dd></div>
                <div><dt>Rationale</dt><dd>{proposal.rationale}</dd></div>
                <div><dt>Related assets</dt><dd>{relatedAssets.length ? relatedAssets.join(', ') : 'None bound'}</dd></div>
              </dl>
            </div>}
          </> : <p className="writeback-unavailable">Disabled by default. Connect DataHub and explicitly enable governed write-back in Settings to make this option available.</p>}
        </section>
      </div>
    </div>

    <footer className="review-actions">
      <ActionButton disabled={applying} icon={<X size={15} />} onClick={onDiscard} variant="secondary">Reject</ActionButton>
      <ActionButton aria-busy={applying} disabled={applying} icon={applying ? <LoaderCircle className="agent-context-wheel" size={15} /> : <Check size={15} />} onClick={() => onApply(writebackRequested)} variant="primary">{applying ? 'Applying change…' : 'Approve change'}</ActionButton>
    </footer>
  </section>
}
