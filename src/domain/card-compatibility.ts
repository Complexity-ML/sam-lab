import type { CardKind } from './pipeline'

const allowedTargets: Record<CardKind, readonly CardKind[]> = {
  control: [],
  explorer: [],
  worker: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  query: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  source: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  profile: ['worker', 'query', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'review', 'validation', 'output'],
  analysis: ['worker', 'query', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  impact: ['worker', 'query', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  risk: ['worker', 'query', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'review', 'validation', 'output'],
  patch: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  monitor: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'parallel', 'diagram', 'split', 'decision', 'validation', 'output'],
  parallel: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  diagram: ['worker', 'query', 'impact', 'risk', 'patch', 'monitor', 'split', 'decision', 'review', 'validation', 'output'],
  split: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'decision', 'transform', 'review', 'validation', 'output'],
  decision: ['worker', 'query', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'transform', 'review', 'validation', 'output'],
  transform: ['worker', 'query', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'],
  review: ['worker', 'query', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'validation', 'output'],
  validation: ['worker', 'query', 'patch', 'monitor', 'decision', 'review', 'output'],
  output: ['monitor'],
}

export function cardConnectionError(source: CardKind, target: CardKind, sourceHandle?: string | null): string | undefined {
  if (source === 'control' || target === 'control') return 'SAM LAB Control is a global policy and cannot enter lineage'
  if (source === 'explorer' || target === 'explorer') return 'Catalog Explorer is a host-owned sidecar and cannot enter lineage'
  if (target === 'source') return 'Data Source must begin a lineage path'
  if (source === 'output') {
    return sourceHandle === 'feedback' && target === 'monitor'
      ? undefined
      : 'Output can connect only to Live Monitor through the feedback handle'
  }
  if (sourceHandle === 'feedback') return 'The feedback handle is reserved for Output → Live Monitor'
  if (source === 'split') {
    if (!['approved', 'quarantine'].includes(sourceHandle ?? '')) return 'Split edges must use approved or quarantine'
  } else if (sourceHandle === 'approved' || sourceHandle === 'quarantine') {
    return 'Approved and quarantine handles are reserved for Split'
  }
  if (sourceHandle && !['approved', 'quarantine', 'feedback'].includes(sourceHandle)) return 'Unknown connection handle'
  if (!allowedTargets[source].includes(target)) return `${source} cannot connect to ${target}`
  return undefined
}

export function canConnectCardKinds(source: CardKind, target: CardKind, sourceHandle?: string | null) {
  return !cardConnectionError(source, target, sourceHandle)
}

export const cardCompatibility = allowedTargets
