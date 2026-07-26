import type { Edge } from '@xyflow/react'
import type { CatalogDatasetCheckpoint, PipelineNode } from './pipeline'
import { parseRiskAssessmentRule, riskDomainFromText, type RiskDomain, type RiskSeverity } from './risk-assessment'
import { isSoftwareAssetCheckpoint } from './sam-asset'

export type RiskImpactItemKind = 'risk' | 'impact' | 'verification' | 'coverage-gap'

export interface RiskImpactItem {
  id: string
  nodeId: string
  kind: RiskImpactItemKind
  domain: RiskDomain
  severity: RiskSeverity
  title: string
  detail: string
  action: string
  evidence?: string
  affectedAssets?: number
  affectedModels?: number
  sourceRef?: string
}

export interface RiskImpactOverview {
  items: RiskImpactItem[]
  actionable: number
  needsVerification: number
  critical: number
  high: number
  coverageGaps: number
}

function hasDownstreamRisk(nodeId: string, nodes: PipelineNode[], edges: Edge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback') outgoing.get(edge.source)?.push(edge.target)
  const queue = [...(outgoing.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) continue
    if (current.data.kind === 'risk') return true
    queue.push(...(outgoing.get(currentId) ?? []))
  }
  return false
}

function riskCardCoversDataset(dataset: CatalogDatasetCheckpoint, nodes: PipelineNode[], domain?: RiskDomain) {
  const needles = [dataset.urn, dataset.name].map((value) => value.trim().toLowerCase()).filter(Boolean)
  return nodes.some((node) => {
    if (node.data.kind !== 'risk') return false
    if (domain && parseRiskAssessmentRule(node.data.rule).domain !== domain) return false
    const text = `${node.data.label} ${node.data.description} ${node.data.rule ?? ''}`.toLowerCase()
    return needles.some((needle) => text.includes(needle))
  })
}

function catalogRiskItems(node: PipelineNode, nodes: PipelineNode[]): RiskImpactItem[] {
  const datasets = (node.data.exploration?.datasets ?? []).filter(isSoftwareAssetCheckpoint)
  const items = datasets.flatMap<RiskImpactItem>((dataset) => {
    if (dataset.status === 'unavailable') return []
    const affectedAssets = Math.max(1, 1 + dataset.upstreamCount + dataset.downstreamCount)
    const items: RiskImpactItem[] = []
    if ((dataset.qualityStatus === 'failing' || dataset.issues.includes('quality failing')) && !riskCardCoversDataset(dataset, nodes, 'reliability')) {
      items.push({
        id: `catalog-quality-${dataset.urn}`,
        nodeId: node.id,
        kind: 'risk',
        domain: 'reliability',
        severity: 'high',
        title: `License evidence quality risk · ${dataset.name}`,
        detail: 'The versioned software-asset checkpoint reports failing evidence quality. Cost, utilization or compliance decisions must wait for a fresh verified snapshot.',
        action: 'Verify this software inventory source, then rerun the bounded license analysis before making a recommendation.',
        evidence: 'catalog_checkpoint:fresh',
        affectedAssets,
        sourceRef: dataset.urn,
      })
    }
    if (!riskCardCoversDataset(dataset, nodes, 'analytics')) {
      items.push(...(dataset.dataRiskSignals ?? []).map((signal) => ({
        id: `catalog-profile-${dataset.urn}-${signal.id}`,
        nodeId: node.id,
        kind: 'risk' as const,
        domain: 'analytics' as const,
        severity: signal.severity,
        title: `License evidence anomaly · ${dataset.name}${signal.field ? ` · ${signal.field}` : ''}`,
        detail: `${signal.summary} This may change seat-utilization, spend or entitlement conclusions.`,
        action: signal.kind === 'duplicate_drift'
          ? 'Verify the product, seat and entitlement key contract before calculating duplicate assignments or reclaim candidates.'
          : 'Refresh the bounded aggregate evidence, recalculate license utilization and cost impact, then submit the recommendation for review.',
        evidence: 'dataset_profile:two_version_aggregate',
        affectedAssets,
        sourceRef: dataset.urn,
      })))
    }
    return items
  })
  const governanceGroups = [
    {
      key: 'owners',
      issue: 'owner missing',
      title: 'Software ownership coverage incomplete',
      action: 'Assign or confirm the product, contract or budget owner, then reassess only the affected software assets.',
    },
    {
      key: 'classifications',
      issue: 'tags missing',
      title: 'Software inventory classification incomplete',
      action: 'Classify the product, license, contract and usage source before calculating compliance or optimization decisions.',
    },
  ] as const
  for (const group of governanceGroups) {
    const affected = datasets.filter((dataset) => dataset.status !== 'unavailable' && dataset.issues.includes(group.issue))
    if (!affected.length) continue
    const examples = affected.slice(0, 5).map((dataset) => dataset.name)
    items.push({
      id: `catalog-governance-${node.id}-${group.key}`,
      nodeId: node.id,
      kind: 'coverage-gap',
      domain: 'governance',
      severity: 'medium',
      title: group.title,
      detail: `${affected.length} software asset source(s) are missing ${group.key === 'owners' ? 'a product, contract or budget owner' : 'software inventory classifications'}${examples.length ? `: ${examples.join(', ')}${affected.length > examples.length ? ` and ${affected.length - examples.length} more` : ''}` : ''}. This is SAM coverage, not a confirmed license risk.`,
      action: group.action,
      evidence: 'catalog_checkpoint:incomplete_governance',
      affectedAssets: affected.length,
    })
  }
  return items
}

export function collectRiskImpactOverview(nodes: PipelineNode[], edges: Edge[]): RiskImpactOverview {
  const items: RiskImpactItem[] = nodes.flatMap((node) => {
    if (node.data.kind === 'explorer') return catalogRiskItems(node, nodes)
    if (node.data.kind === 'risk') {
      const risk = parseRiskAssessmentRule(node.data.rule)
      return [{
        id: `risk-${node.id}`,
        nodeId: node.id,
        kind: 'risk' as const,
        domain: risk.domain,
        severity: risk.severity ?? 'unknown',
        title: node.data.label,
        detail: node.data.description,
        action: risk.action || 'Complete this evidence-backed risk assessment.',
        evidence: risk.evidence,
        affectedAssets: risk.affectedAssets,
        affectedModels: risk.affectedModels,
      }]
    }
    if (node.data.kind !== 'impact') return []
    const domain = riskDomainFromText(`${node.data.label} ${node.data.description} ${node.data.rule ?? ''}`)
    const impact: RiskImpactItem = {
      id: `impact-${node.id}`,
      nodeId: node.id,
      kind: 'impact',
      domain,
      severity: 'unknown',
      title: node.data.label,
      detail: node.data.description,
      action: 'Trace this impact through an evidence-backed Risk Assessment.',
    }
    if (hasDownstreamRisk(node.id, nodes, edges)) return [impact]
    return [impact, {
      id: `coverage-${node.id}`,
      nodeId: node.id,
      kind: 'coverage-gap' as const,
      domain,
      severity: 'medium' as const,
      title: `Risk coverage missing · ${node.data.label}`,
      detail: 'This Impact Analysis has no downstream Risk Assessment, so severity, confidence, evidence and mitigation are not yet explicit.',
      action: 'Ask the agent to add an evidence-backed Risk Assessment and a bounded mitigation path.',
    }]
  })
  const actionableItems = items.filter((item) => item.kind === 'risk' && !['low', 'unknown'].includes(item.severity))
  return {
    items,
    actionable: actionableItems.length,
    needsVerification: items.filter((item) => item.kind === 'verification').length,
    critical: items.filter((item) => item.kind === 'risk' && item.severity === 'critical').length,
    high: items.filter((item) => item.kind === 'risk' && item.severity === 'high').length,
    coverageGaps: items.filter((item) => item.kind === 'coverage-gap').length,
  }
}

export function riskItemsForDomain(overview: RiskImpactOverview, domain: 'all' | RiskDomain) {
  return domain === 'all' ? overview.items : overview.items.filter((item) => item.domain === domain)
}
