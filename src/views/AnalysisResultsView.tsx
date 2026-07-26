import { AlertTriangle, CheckCircle2, Database, FileCheck2, PanelRightClose, ShieldAlert, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import { PanelHeader } from '../components/shared/PanelHeader'
import { PanelScrollArea } from '../components/shared/PanelScrollArea'
import { buildAnalysisReport } from '../domain/analysis-report'
import type { AgentProposal, PipelineNode } from '../domain/pipeline'
import type { RiskImpactOverview } from '../domain/risk-impact'

interface AnalysisResultsViewProps {
  onClose(): void
  onOpenProposal(): void
  onSelectCard(nodeId: string): void
  nodes: PipelineNode[]
  overview: RiskImpactOverview
  proposal?: AgentProposal
}

export function AnalysisResultsView({ nodes, onClose, onOpenProposal, onSelectCard, overview, proposal }: AnalysisResultsViewProps) {
  const report = useMemo(() => buildAnalysisReport(nodes, overview), [nodes, overview])
  return <>
    <PanelHeader action={<button aria-label="Close analysis results" className="panel-toggle" onClick={onClose} title="Close analysis results" type="button"><PanelRightClose size={16} /></button>} eyebrow="RESULTS" title="Analysis report" titleId="analysis-results-title" />
    <PanelScrollArea className="reports-panel-content" label="Analysis results content">
      <section className="analysis-executive-summary">
        <small>EXECUTIVE SUMMARY</small>
        <h3>{report.scope}</h3>
        <p>{report.summary}</p>
      </section>

      <section className="analysis-results-overview">
        <div><strong>{report.risks.length}</strong><small>Risk signals</small></div>
        <div><strong>{report.inspectedAssets}/{report.totalAssets}</strong><small>Catalog checked</small></div>
        <div><strong>{report.aggregateProfiles}</strong><small>Aggregate profiles</small></div>
        <div><strong>{report.coverageGaps}</strong><small>Profile gaps</small></div>
      </section>

      {report.decisionFacts.length > 0 && <>
        <div className="reports-heading"><strong>License decision</strong><small>{report.decisionFacts.length} verified facts</small></div>
        <section className="analysis-results-overview analysis-license-facts">
          {report.decisionFacts.map((fact) => <div key={fact.label}><strong>{fact.value}</strong><small>{fact.label}</small></div>)}
        </section>
      </>}

      {proposal && <button className="report-proposal" onClick={onOpenProposal} type="button"><Sparkles size={16} /><span><small>PROPOSED SOLUTION</small><strong>{proposal.title}</strong><p>{proposal.summary}</p></span></button>}

      <div className="reports-heading"><strong>Material findings</strong><small>{report.risks.length} signal{report.risks.length === 1 ? '' : 's'}</small></div>
      {report.risks.length ? <div className="analysis-result-risks">{report.risks.map((risk) => <button aria-label={`Inspect result ${risk.title}`} className={`severity-${risk.severity}`} key={risk.id} onClick={() => onSelectCard(risk.nodeId)} type="button">
        <ShieldAlert size={16} />
        <span><small>{risk.domain} · {risk.kind.replace('-', ' ')} · {risk.severity}</small><strong>{risk.title}</strong><p>{risk.detail}</p><dl>
          {risk.confidence !== undefined && <div><dt>Confidence</dt><dd>{Math.round(risk.confidence * 100)}%</dd></div>}
          {risk.evidence && <div><dt>Evidence</dt><dd>{risk.evidence}</dd></div>}
          {risk.affectedAssets !== undefined && <div><dt>{risk.kind === 'risk' ? 'Downstream affected' : 'Affected assets'}</dt><dd>{risk.affectedAssets}</dd></div>}
        </dl><em>Recommended action: {risk.action}</em></span>
      </button>)}</div> : <div className="reports-clear"><CheckCircle2 size={18} /><span><strong>No materialized risk</strong><small>The current graph contains no Risk Assessment result.</small></span></div>}

      <div className="reports-heading"><strong>Analysis trail</strong><small>{report.evidence.length} result card{report.evidence.length === 1 ? '' : 's'}</small></div>
      {report.evidence.length ? <div className="analysis-result-evidence">{report.evidence.map((item) => <button aria-label={`Inspect evidence ${item.title}`} key={item.nodeId} onClick={() => onSelectCard(item.nodeId)} type="button">
        {item.kind === 'profile' ? <Database size={15} /> : <FileCheck2 size={15} />}
        <span><small>{item.label}</small><strong>{item.title}</strong><p>{item.detail}</p></span>
      </button>)}</div> : <div className="reports-clear"><FileCheck2 size={18} /><span><strong>No analysis output yet</strong><small>Profile, Analysis, Impact, Validation and Output cards will be summarized here.</small></span></div>}

      <section className={`analysis-limitations${report.limitations.length ? ' has-gaps' : ''}`}>
        <div><AlertTriangle size={15} /><strong>Coverage &amp; limitations</strong></div>
        {report.limitations.length
          ? <ul>{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          : <p>No aggregate evidence coverage gap is recorded in the current graph.</p>}
      </section>

    </PanelScrollArea>
  </>
}
