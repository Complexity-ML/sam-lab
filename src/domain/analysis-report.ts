import type { PipelineNode } from './pipeline'
import type { RiskImpactItemKind, RiskImpactOverview } from './risk-impact'
import { parseRiskAssessmentRule, type RiskSeverity } from './risk-assessment'
import { isSoftwareAssetGraph } from './sam-asset'

export interface AnalysisReportRisk {
  id: string
  nodeId: string
  title: string
  detail: string
  domain: string
  kind: RiskImpactItemKind
  severity: RiskSeverity
  confidence?: number
  evidence?: string
  affectedAssets?: number
  sensitiveSignals?: number
  scope?: string
  action: string
}

export interface AnalysisReportEvidence {
  nodeId: string
  kind: string
  label: string
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
  decisionFacts: { label: string; value: string }[]
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

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]
}

function softwareDecisionFacts(nodes: PipelineNode[]) {
  if (!isSoftwareAssetGraph(nodes)) return []
  const text = nodes.map((node) => `${node.data.label}. ${node.data.description}. ${node.data.rule ?? ''}`).join(' ')
  const source = nodes.find((node) => node.data.kind === 'source')
  const purchased = firstMatch(text, /\b([\d,.]+)\s+purchased(?:\s+seats?)?/i)
  const assigned = firstMatch(text, /\b([\d,.]+)\s+assigned(?:\s+seats?)?/i)
  const active = firstMatch(text, /\b([\d,.]+)\s+active(?:\s+seats?)?/i)
  const candidates = firstMatch(text, /\b(?:identifies?|found|flags?)\s+([\d,.]+)\s+(?:seats?\s+)?(?:inactive|reclaim|candidates?)/i)
    ?? firstMatch(text, /\b([\d,.]+)\s+(?:reclaim\s+)?candidates?\b/i)
  const eligible = firstMatch(text, /\b(?:values?|identifies?)\s+([\d,.]+)\s+eligible\s+seats?/i)
    ?? firstMatch(text, /\b([\d,.]+)\s+eligible\s+reclaims?\b/i)
  const savingsMatch = text.match(/\b(USD|EUR|GBP)\s*([\d,.]+)\s+(?:in\s+)?annual(?:ized)?\s+savings?/i)
    ?? text.match(/\bannual(?:ized)?\s+savings?(?:\s+(?:target|opportunity))?(?:\s+of)?\s+(USD|EUR|GBP)\s*([\d,.]+)/i)

  return [
    ...(source ? [{ label: 'Software product', value: source.data.label }] : []),
    ...(purchased ? [{ label: 'Purchased seats', value: purchased }] : []),
    ...(assigned ? [{ label: 'Assigned seats', value: assigned }] : []),
    ...(active ? [{ label: 'Active seats', value: active }] : []),
    ...(candidates ? [{ label: 'Review candidates', value: candidates }] : []),
    ...(eligible ? [{ label: 'Eligible reclamations', value: eligible }] : []),
    ...(savingsMatch ? [{ label: 'Annual savings', value: `${savingsMatch[1]} ${savingsMatch[2]}` }] : []),
  ]
}

export function buildAnalysisReport(nodes: PipelineNode[], overview?: RiskImpactOverview): AnalysisReport {
  const sources = nodes.filter((node) => node.data.kind === 'source')
  const softwareAssetReport = isSoftwareAssetGraph(nodes)
  const decisionFacts = softwareDecisionFacts(nodes)
  const exploration = nodes
    .filter((node) => node.data.kind === 'explorer' && node.data.exploration)
    .map((node) => node.data.exploration!)
    .sort((left, right) => right.inspected - left.inspected || right.total - left.total)[0]
  const inspectedAssets = exploration?.inspected ?? sources.length
  const totalAssets = exploration?.total ?? sources.length
  const aggregateProfiles = exploration?.dataAudited
    ?? exploration?.datasets.filter((dataset) => dataset.dataAuditStatus === 'complete').length
    ?? Math.max(
      nodes.filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status === 'complete').length,
      softwareAssetReport && sources.some((node) => node.data.schema.some((field) => /\b(?:purchased|assigned|active|usage|utilization|cost|spend|renewal|entitlement)\b/i.test(field.name.replaceAll('_', ' ')))) ? 1 : 0,
    )
  const coverageGaps = exploration?.dataAuditCoverageGaps
    ?? exploration?.datasets.filter((dataset) => dataset.dataAuditStatus === 'coverage_gap').length
    ?? nodes.filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status === 'coverage_gap').length

  const riskItems = overview?.items ?? nodes
    .filter((node) => node.data.kind === 'risk')
    .map((node) => {
      const parsed = parseRiskAssessmentRule(node.data.rule)
      return {
        id: `risk-${node.id}`,
        nodeId: node.id,
        kind: 'risk' as const,
        domain: parsed.domain,
        severity: parsed.severity ?? 'unknown',
        title: node.data.label,
        detail: node.data.description,
        action: parsed.action || 'Review the evidence and define a governed next action.',
        evidence: parsed.evidence,
        affectedAssets: parsed.affectedAssets,
      }
    })
  const risks = riskItems
    .map((item): AnalysisReportRisk => {
      const node = nodes.find((candidate) => candidate.id === item.nodeId)
      const parsed = node?.data.kind === 'risk' ? parseRiskAssessmentRule(node.data.rule) : undefined
      const sensitiveSignals = Number(item.detail.match(/\b(\d+)\s+sensitive (?:field\/tag signals?|fields?|signals?)(?:\(s\))?/i)?.[1])
      return {
        id: item.id,
        nodeId: item.nodeId,
        title: /^host risk\b/i.test(item.title)
          ? `${parsed?.scope || 'Dataset'} ${humanizeAnalysisValue(item.domain)} risk`
          : item.title,
        detail: item.detail
          .replace(/^Evidence-backed risk preserved before mitigation\.\s*/i, '')
          .replace(/^HIGH host risk score/i, 'Host risk score'),
        domain: item.domain,
        kind: item.kind,
        severity: item.severity,
        confidence: parsed?.confidence,
        evidence: item.evidence,
        affectedAssets: item.affectedAssets,
        sensitiveSignals: Number.isFinite(sensitiveSignals) ? sensitiveSignals : undefined,
        scope: parsed?.scope || undefined,
        action: humanizeAnalysisValue(item.action),
      }
    })
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || (left.kind === 'risk' ? -1 : 1))
  const primaryRisk = risks.find((risk) => risk.kind === 'risk') ?? risks[0]

  const sourceScope = sources.map((node) => node.data.label).slice(0, 3).join(', ')
  const riskScope = primaryRisk?.scope
  const profileScope = nodes.find((node) => node.data.kind === 'profile')?.data.label.replace(/\s+profile$/i, '')
  const scopeBase = sourceScope || riskScope || profileScope || 'Current workbench'
  const scope = softwareAssetReport
    ? `${scopeBase} software asset analysis`
    : primaryRisk ? `${scopeBase} ${humanizeAnalysisValue(primaryRisk.domain)} analysis` : `${scopeBase} analysis`

  const evidenceKinds = new Set(['profile', 'analysis', 'impact', 'validation', 'output'])
  const evidence = nodes
    .filter((node) => evidenceKinds.has(node.data.kind))
    .map((node): AnalysisReportEvidence => ({
      nodeId: node.id,
      kind: humanizeAnalysisValue(node.data.kind),
      label: node.data.kind === 'profile'
        ? node.data.profile?.aggregateAudit.status === 'complete' ? 'aggregate profile' : 'metadata profile'
        : humanizeAnalysisValue(node.data.kind),
      title: node.data.label,
      detail: node.data.description,
    }))

  const limitations = [
    ...(coverageGaps > 0 ? [`${coverageGaps} ${softwareAssetReport ? 'catalog software asset' : 'catalog asset'}${coverageGaps === 1 ? '' : 's'} lack${coverageGaps === 1 ? 's' : ''} an aggregate value profile. No ${softwareAssetReport ? 'license optimization or compliance conclusion' : 'value-level anomaly'} is asserted for that uncovered evidence.`] : []),
    ...nodes
      .filter((node) => node.data.kind === 'profile' && node.data.profile?.aggregateAudit.status !== 'complete')
      .map((node) => `${node.data.label} contains schema metadata only; aggregate row, null, uniqueness and distribution evidence is ${humanizeAnalysisValue(node.data.profile?.aggregateAudit.status ?? 'unavailable')}.`),
  ].filter((value, index, all) => all.indexOf(value) === index)

  const severityLabel = primaryRisk ? primaryRisk.severity.charAt(0).toUpperCase() + primaryRisk.severity.slice(1) : ''
  const decisionFact = (label: string) => decisionFacts.find((fact) => fact.label === label)?.value
  const seatSummary = softwareAssetReport && decisionFact('Purchased seats')
    ? `${decisionFact('Software product') ?? scopeBase}: ${decisionFact('Purchased seats')} purchased seats, ${decisionFact('Assigned seats') ?? 'an unreported number'} assigned and ${decisionFact('Active seats') ?? 'an unreported number'} active.`
    : ''
  const opportunitySummary = softwareAssetReport && (decisionFact('Review candidates') || decisionFact('Eligible reclamations') || decisionFact('Annual savings'))
    ? `${decisionFact('Review candidates') ? `${decisionFact('Review candidates')} seats require review` : 'Reclamation candidates require review'}${decisionFact('Eligible reclamations') ? `; ${decisionFact('Eligible reclamations')} are eligible for reclamation` : ''}${decisionFact('Annual savings') ? `, representing ${decisionFact('Annual savings')} in annual savings` : ''}.`
    : ''
  const summaryParts = primaryRisk
    ? [
        seatSummary,
        opportunitySummary,
        !softwareAssetReport && primaryRisk.sensitiveSignals !== undefined
          ? `${scopeBase} contains ${primaryRisk.sensitiveSignals} sensitive field or tag signal${primaryRisk.sensitiveSignals === 1 ? '' : 's'}.`
          : `${scopeBase} has a ${severityLabel} ${softwareAssetReport ? 'software asset' : humanizeAnalysisValue(primaryRisk.domain)} risk.`,
        `The ${softwareAssetReport ? 'decision' : humanizeAnalysisValue(primaryRisk.domain) + ' risk'} is rated ${severityLabel}${primaryRisk.confidence !== undefined ? ` with ${Math.round(primaryRisk.confidence * 100)}% confidence` : ''}${primaryRisk.affectedAssets !== undefined ? ` and covers ${primaryRisk.affectedAssets} ${softwareAssetReport ? 'licenses or affected records' : `downstream asset${primaryRisk.affectedAssets === 1 ? '' : 's'}`}` : ''}.`,
        aggregateProfiles === 0
          ? `Aggregate evidence is unavailable; therefore, no ${softwareAssetReport ? 'license optimization or compliance conclusion' : 'value-level anomaly'} is claimed.`
          : coverageGaps > 0
            ? `${aggregateProfiles} aggregate profile${aggregateProfiles === 1 ? ' is' : 's are'} available, while ${coverageGaps} catalog asset${coverageGaps === 1 ? '' : 's'} remain uncovered for value-level analysis.`
            : `${aggregateProfiles} aggregate profile${aggregateProfiles === 1 ? '' : 's'} provide value-level evidence.`,
        /human review|review|verify|verification/i.test(primaryRisk.action)
          ? 'Human review and post-mitigation verification are required.'
          : `Recommended next action: ${primaryRisk.action}.`,
        totalAssets > 0 ? `${softwareAssetReport ? 'Software catalog' : 'Catalog'} coverage: ${inspectedAssets}/${totalAssets} assets checked.` : '',
      ]
    : [
        'No Risk Assessment result is present in the current graph.',
        totalAssets > 0 ? `Catalog coverage: ${inspectedAssets}/${totalAssets} assets checked, with ${aggregateProfiles} aggregate profiles and ${coverageGaps} profile gaps.` : 'No connected-catalog coverage checkpoint is present.',
      ]

  return {
    scope,
    summary: summaryParts.filter(Boolean).join(' '),
    inspectedAssets,
    totalAssets,
    aggregateProfiles,
    coverageGaps,
    risks,
    evidence,
    decisionFacts,
    limitations,
  }
}
