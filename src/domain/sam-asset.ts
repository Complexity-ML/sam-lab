import type { CatalogDatasetCheckpoint, PipelineNode } from './pipeline'

const samAssetPattern = /\b(?:sam|software|saas|application|apps?|product|vendor|sku|license|licence|licensing|subscription|seat|assignment|entitlement|contract|renewal|utili[sz]ation|usage|reclaim|spend|cost|procurement)\b/i

function searchableCheckpointText(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  return `${checkpoint.name.replaceAll('_', ' ')} ${checkpoint.urn.replaceAll(/[_:.,()/-]+/g, ' ')}`
}

export function isSoftwareAssetCheckpoint(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  return samAssetPattern.test(searchableCheckpointText(checkpoint))
}

export function isSoftwareAssetGraph(nodes: PipelineNode[]) {
  return nodes.some((node) => samAssetPattern.test([
    node.data.label,
    node.data.description,
    node.data.rule,
    node.data.datahubUrn,
    node.data.datahubDomain,
    ...(node.data.datahubTags ?? []),
    ...node.data.schema.map((field) => field.name),
  ].filter(Boolean).join(' ').replaceAll('_', ' ')))
}

export function softwareAssetPriority(checkpoint: Pick<CatalogDatasetCheckpoint, 'name' | 'urn'>) {
  if (!isSoftwareAssetCheckpoint(checkpoint)) return 0
  const text = searchableCheckpointText(checkpoint)
  if (/\b(?:license|licence|seat|entitlement|subscription|contract|renewal|utili[sz]ation|reclaim)\b/i.test(text)) return 3
  if (/\b(?:software|saas|application|product|vendor|sku|usage|spend|cost|procurement)\b/i.test(text)) return 2
  return 1
}
