export type CatalogExplorerScope = 'dataset' | 'all_datasets'
export type CatalogExplorerCacheMode = 'prefer' | 'refresh'

export interface CatalogExplorerPolicy {
  scope: CatalogExplorerScope
  datasetUrn: string
  batchSize: number
  concurrency: number
  cacheMode: CatalogExplorerCacheMode
  resume: boolean
}

export const defaultCatalogExplorerPolicy: CatalogExplorerPolicy = {
  scope: 'all_datasets',
  datasetUrn: '',
  batchSize: 8,
  concurrency: 4,
  cacheMode: 'prefer',
  resume: true,
}

function entries(rule: string | undefined) {
  return new Map((rule ?? '').split('|').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    return key ? [[key, value] as const] : []
  }))
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function parseCatalogExplorerPolicy(rule: string | undefined): CatalogExplorerPolicy {
  const values = entries(rule)
  const scope = values.get('scope') === 'dataset' ? 'dataset' : 'all_datasets'
  const cacheMode = values.get('cache') === 'refresh' ? 'refresh' : 'prefer'
  return {
    scope,
    datasetUrn: values.get('dataset_urn')?.slice(0, 2_000) ?? '',
    batchSize: boundedInteger(values.get('batch_size') ?? values.get('max_inspections'), defaultCatalogExplorerPolicy.batchSize, 1, 32),
    concurrency: boundedInteger(values.get('audit_concurrency'), defaultCatalogExplorerPolicy.concurrency, 1, 8),
    cacheMode,
    resume: values.get('resume') !== 'false',
  }
}

export function catalogExplorerPolicyRule(policy: CatalogExplorerPolicy) {
  const scope = policy.scope === 'dataset' ? 'dataset' : 'all_datasets'
  const dataset = scope === 'dataset' && policy.datasetUrn.trim()
    ? ` | dataset_urn=${policy.datasetUrn.trim().slice(0, 2_000)}`
    : ''
  return `scope=${scope}${dataset} | batch_size=${Math.max(1, Math.min(32, Math.round(policy.batchSize)))} | audit_concurrency=${Math.max(1, Math.min(8, Math.round(policy.concurrency)))} | cache=${policy.cacheMode === 'refresh' ? 'refresh' : 'prefer'} | checkpoint=versioned | resume=${policy.resume !== false}`
}

export function catalogExplorerCheckpointScope(rule: string | undefined) {
  const policy = parseCatalogExplorerPolicy(rule)
  return policy.scope === 'dataset' ? `dataset:${policy.datasetUrn}` : 'all_datasets'
}

export function catalogExplorerPolicyError(rule: string | undefined) {
  const values = entries(rule)
  const scope = values.get('scope')
  if (scope !== 'dataset' && scope !== 'all_datasets') return 'Choose one dataset or the entire connected catalog.'
  if (scope === 'dataset' && !values.get('dataset_urn')?.trim()) return 'Focused exploration requires a dataset URN.'
  const batchValue = values.get('batch_size') ?? values.get('max_inspections')
  const batchSize = Number(batchValue)
  if (batchValue !== undefined && (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32)) return 'Batch size must be between 1 and 32.'
  const concurrency = Number(values.get('audit_concurrency'))
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return 'Worker concurrency must be between 1 and 8.'
  if (values.has('cache') && !['prefer', 'refresh'].includes(values.get('cache') ?? '')) return 'Cache strategy must prefer saved evidence or force a refresh.'
  if (values.get('checkpoint') !== 'versioned') return 'Catalog checkpoints must remain versioned.'
  if (values.get('resume') !== 'true') return 'Catalog exploration must remain resumable.'
  return undefined
}
