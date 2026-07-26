import type { CatalogDatasetCheckpoint, PipelineNode } from './pipeline'

const directSamAssetPattern = /\b(?:sam|software|saas|licenses?|licences?|licensing|subscriptions?|seats?|entitlements?|renewals?|reclaims?)\b/i
const explicitInventoryPattern = /\b(?:applications?|apps?|vendors?|products?|skus?)\s+(?:inventory|portfolio|catalog|licen[cs]e|subscription|entitlement|assignment|utili[sz]ation|usage|spend|cost|renewal)\b|\b(?:inventory|portfolio|catalog|licen[cs]e|subscription|entitlement|assignment|utili[sz]ation|usage|spend|cost|renewal)\s+(?:applications?|apps?|vendors?|products?|skus?)\b/i
const evidenceKinds = new Set(['source', 'profile', 'analysis', 'impact', 'risk', 'query', 'patch', 'transform', 'decision'])

function searchableCheckpointText(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  return `${checkpoint.name.replaceAll('_', ' ')} ${checkpoint.urn.replaceAll(/[_:.,()/-]+/g, ' ')}`
}

export function isSoftwareAssetText(value: string) {
  const normalized = value.replaceAll(/[_:.,()/-]+/g, ' ')
  return directSamAssetPattern.test(normalized) || explicitInventoryPattern.test(normalized)
}

export function isSoftwareAssetCheckpoint(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  return isSoftwareAssetText(searchableCheckpointText(checkpoint))
}

export function isSoftwareAssetNode(node: PipelineNode) {
  if (!evidenceKinds.has(node.data.kind)) return false
  return isSoftwareAssetText([
    node.data.label,
    node.data.description,
    node.data.rule,
    node.data.datahubUrn,
    node.data.datahubDomain,
    ...(node.data.datahubTags ?? []),
    ...node.data.schema.map((field) => field.name),
  ].filter(Boolean).join(' '))
}

export function isSoftwareAssetGraph(nodes: PipelineNode[]) {
  return nodes.some((node) => isSoftwareAssetNode(node)
    || (node.data.kind === 'explorer' && node.data.exploration?.datasets.some(isSoftwareAssetCheckpoint)))
}

export function softwareAssetPriority(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  if (!isSoftwareAssetCheckpoint(checkpoint)) return 0
  const text = searchableCheckpointText(checkpoint)
  if (/\b(?:license|licence|seat|entitlement|subscription|contract|renewal|utili[sz]ation|reclaim)\b/i.test(text)) return 3
  if (/\b(?:software|saas|application|vendor|sku|usage|spend|cost|procurement)\b/i.test(text)) return 2
  return 1
}
