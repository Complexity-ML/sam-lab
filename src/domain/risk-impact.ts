import type { Edge } from '@xyflow/react'
import type { CatalogDatasetCheckpoint, PipelineNode } from './pipeline'
import { parseRiskAssessmentRule, riskDomainFromText, type RiskDomain, type RiskSeverity } from './risk-assessment'

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
  const datasets = node.data.exploration?.datasets ?? []
  const items = datasets.flatMap<RiskImpactItem>((dataset) => {
    if (dataset.status === 'unavailable') return []
    const affectedAssets = Math.max(1, 1 + dataset.upstreamCount + dataset.downstreamCount)
    const items: RiskImpactItem[] = []
    if ((dataset.qualityStatus === 'failing' || dataset.issues.includes('quality failing')) && !riskCardCoversDataset(dataset, nodes, 'data')) {
      items.push({
        id: `catalog-quality-${dataset.urn}`,
        nodeId: node.id,
        kind: 'risk',
        domain: 'data',
        severity: 'high',
        title: `Data quality risk · ${dataset.name}`,
        detail: 'The versioned catalog checkpoint reports a failing quality signal. This is dataset evidence, not a connector failure.',
        action: 'Inspect this dataset deeply, trace its impact, then propose a bounded correction and fresh post-condition verification.',
        evidence: 'catalog_checkpoint:fresh',
        affectedAssets,
        sourceRef: dataset.urn,
      })
    }
    if (!riskCardCoversDataset(dataset, nodes, 'data')) {
      items.push(...(dataset.dataRiskSignals ?? []).map((signal) => ({
        id: `catalog-profile-${dataset.urn}-${signal.id}`,
        nodeId: node.id,
        kind: 'risk' as const,
        domain: 'data' as const,
        severity: signal.severity,
        title: `${signal.kind.replaceAll('_', ' ')} · ${dataset.name}${signal.field ? ` · ${signal.field}` : ''}`,
        detail: signal.summary,
        action: signal.kind === 'duplicate_drift'
          ? 'Verify the expected key contract, inspect downstream impact, then propose deduplication or quarantine without mutating source data.'
          : 'Inspect this dataset deeply, trace downstream impact, propose a bounded graph correction, then verify against a fresh statistical profile.',
        evidence: 'dataset_profile:two_version_aggregate',
        affectedAssets,
        sourceRef: dataset.urn,
      })))
    }
    if ((dataset.downstreamMlCount ?? 0) > 0 && (dataset.dataRiskSignals?.length ?? 0) > 0 && !riskCardCoversDataset(dataset, nodes, 'ml')) {
      const refs = dataset.downstreamMlRefs ?? []
      items.push(...(dataset.dataRiskSignals ?? []).map((signal) => ({
        id: `catalog-ml-${dataset.urn}-${signal.id}`,
        nodeId: node.id,
        kind: 'risk' as const,
        domain: 'ml' as const,
        severity: signal.severity,
        title: `ML dependency risk · ${dataset.name}${signal.field ? ` · ${signal.field}` : ''}`,
        detail: `${signal.summary} Versioned lineage proves ${dataset.downstreamMlCount} downstream ML feature, model or deployment dependency/dependencies${refs.length ? `: ${refs.map((ref) => ref.name).join(', ')}` : ''}.`,
        action: 'Assess training and serving impact, quarantine the affected evidence path when necessary, and require a fresh profile before retraining or promotion.',
        evidence: 'dataset_profile:two_version_aggregate+lineage:versioned',
        affectedAssets,
        affectedModels: dataset.downstreamMlCount,
        sourceRef: dataset.urn,
      })))
    }
    if ((dataset.sensitiveSignalCount ?? 0) > 0 && !riskCardCoversDataset(dataset, nodes, 'privacy')) {
      items.push({
        id: `catalog-sensitive-${dataset.urn}`,
        nodeId: node.id,
        kind: 'verification',
        domain: 'privacy',
        severity: 'medium',
        title: `Sensitive-data exposure to verify · ${dataset.name}`,
        detail: `${dataset.sensitiveSignalCount} sensitive field or classification signal(s) are present, but downstream exposure has not been proven.`,
        action: 'Inspect only this dataset and add an evidence-backed privacy Risk Assessment when its lineage proves exposure.',
        evidence: 'catalog_checkpoint:fresh',
        affectedAssets,
        sourceRef: dataset.urn,
      })
    }
    return items
  })
  const governanceGroups = [
    {
      key: 'owners',
      issue: 'owner missing',
      title: 'Ownership coverage incomplete',
      action: 'Assign or confirm owners in DataHub, then reassess only the affected datasets.',
    },
    {
      key: 'classifications',
      issue: 'tags missing',
      title: 'Classification coverage incomplete',
      action: 'Complete catalog tags or glossary classifications in DataHub, then reassess only sensitive or downstream-critical datasets.',
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
      detail: `${affected.length} dataset(s) are missing ${group.key === 'owners' ? 'an owner' : 'tags or classifications'}${examples.length ? `: ${examples.join(', ')}${affected.length > examples.length ? ` and ${affected.length - examples.length} more` : ''}` : ''}. This is catalog coverage, not a confirmed data risk.`,
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
