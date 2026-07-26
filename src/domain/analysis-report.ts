import type { PipelineNode } from './pipeline'
import { parseRiskAssessmentRule, type RiskSeverity } from './risk-assessment'

export interface AnalysisReportRisk {
  nodeId: string
  title: string
  detail: string
  domain: string
  severity: RiskSeverity
  confidence?: number
  evidence?: string
  affectedAssets?: number
  action: string
}

export interface AnalysisReportEvidence {
  nodeId: string
  kind: string
  title: string
  detail: string
}

export interface AnalysisReport {
  scope: string
  summary: string
  inspectedAssets: number
  totalAssets: number
  aggregateProfiles: number
  coverageGaps: number
  risks: AnalysisReportRisk[]
  evidence: AnalysisReportEvidence[]
  limitations: string[]
}

const severityRank: Record<RiskSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
}

export function humanizeAnalysisValue(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildAnalysisReport(nodes: PipelineNode[]): AnalysisReport {
  const sources = nodes.filter((node) => node.data.kind === 'source')
  const scope = sources.map((node) => node.data.label).slice(0, 3).join(', ') || 'Current workbench'
  const exploration = nodes
    .filter((node) => node.data.kind === 'explorer' && node.data.exploration)
    .map((node) => node.data.exploration!)
    .sort((left, right) => right.inspected - left.inspected || right.total - left.total)[0]
  const inspectedAssets = exploration?.inspected ?? sources.length
  const totalAssets = exploration?.total ?? sources.length
  const aggregateProfiles = exploration?.dataAudited
    ?? exploration?.datasets.filter((dataset) => dataset.dataAuditStatus === 'complete').length
    ?? nodes.filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status === 'complete').length
  const coverageGaps = exploration?.dataAuditCoverageGaps
    ?? exploration?.datasets.filter((dataset) => dataset.dataAuditStatus === 'coverage_gap').length
    ?? nodes.filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status === 'coverage_gap').length

  const risks = nodes
    .filter((node) => node.data.kind === 'risk')
    .map((node): AnalysisReportRisk => {
      const risk = parseRiskAssessmentRule(node.data.rule)
      return {
        nodeId: node.id,
        title: node.data.label,
        detail: node.data.description,
        domain: risk.domain,
        severity: risk.severity ?? 'unknown',
        confidence: risk.confidence,
        evidence: risk.evidence,
        affectedAssets: risk.affectedAssets,
        action: humanizeAnalysisValue(risk.action || 'Review the evidence and define a governed next action.'),
      }
    })
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity])

  const evidenceKinds = new Set(['profile', 'analysis', 'impact', 'validation', 'output'])
  const evidence = nodes
    .filter((node) => evidenceKinds.has(node.data.kind))
    .map((node): AnalysisReportEvidence => ({
      nodeId: node.id,
      kind: humanizeAnalysisValue(node.data.kind),
      title: node.data.label,
      detail: node.data.description,
    }))

  const limitations = [
    ...(coverageGaps > 0 ? [`${coverageGaps} catalog asset${coverageGaps === 1 ? '' : 's'} lack${coverageGaps === 1 ? 's' : ''} an aggregate value profile. No value-level anomaly is asserted for that uncovered evidence.`] : []),
    ...nodes
      .filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status !== 'complete')
      .map((node) => `${node.data.label}: aggregate profile ${humanizeAnalysisValue(node.data.profile?.aggregateAudit.status ?? 'unavailable')}.`),
  ].filter((value, index, all) => all.indexOf(value) === index)

  const elevated = risks.filter((risk) => ['critical', 'high'].includes(risk.severity)).length
  const coverageSentence = totalAssets > 0
    ? `${inspectedAssets}/${totalAssets} catalog assets were inspected; ${aggregateProfiles} have aggregate profile evidence and ${coverageGaps} remain coverage gaps.`
    : 'No connected-catalog coverage checkpoint is present.'
  const riskSentence = risks.length
    ? `${risks.length} risk${risks.length === 1 ? '' : 's'} were materialized${elevated ? `, including ${elevated} high or critical finding${elevated === 1 ? '' : 's'}` : ''}.`
    : 'No Risk Assessment card is present in the current graph.'

  return {
    scope,
    summary: `Analysis of ${scope}: ${riskSentence} ${coverageSentence}`,
    inspectedAssets,
    totalAssets,
    aggregateProfiles,
    coverageGaps,
    risks,
    evidence,
    limitations,
  }
}
