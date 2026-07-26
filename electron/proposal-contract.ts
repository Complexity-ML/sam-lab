type JsonRecord = Record<string, unknown>

export type ProposalActionType = 'add_card' | 'update_card' | 'add_edge' | 'remove_edge'
export type ProposalCardKind = 'control' | 'explorer' | 'worker' | 'query' | 'source' | 'profile' | 'analysis' | 'impact' | 'risk' | 'patch' | 'monitor' | 'parallel' | 'diagram' | 'split' | 'decision' | 'transform' | 'review' | 'validation' | 'output'

export interface ValidatedProposalAction {
  type: ProposalActionType
  node_id: string | null
  kind: ProposalCardKind | null
  label: string | null
  description: string | null
  owner: string | null
  rule: string | null
  source: string | null
  target: string | null
  source_handle: string | null
  reason: string
}

export interface ValidatedProposal {
  title: string
  summary: string
  rationale: string
  requires_human_review: boolean
  confidence: number
  writeback: string
  evidence: string[]
  actions: ValidatedProposalAction[]
}

const rootKeys = ['title', 'summary', 'rationale', 'requires_human_review', 'confidence', 'writeback', 'evidence', 'actions'] as const
const actionKeys = ['type', 'node_id', 'kind', 'label', 'description', 'owner', 'rule', 'source', 'target', 'source_handle', 'reason'] as const
const kinds = new Set<ProposalCardKind>(['control', 'explorer', 'worker', 'query', 'source', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'])
const actionTypes = new Set<ProposalActionType>(['add_card', 'update_card', 'add_edge', 'remove_edge'])
const cardNames: Record<ProposalCardKind, string> = { control: 'SAM LAB Control', explorer: 'Catalog Explorer', worker: 'Worker Node', query: 'Query Check', source: 'Data Source', profile: 'Data Profile', analysis: 'Data Analysis', impact: 'Impact Analysis', risk: 'Risk Assessment', patch: 'Compatibility Patch', monitor: 'Live Monitor', parallel: 'Parallel Agents', diagram: 'Incident Diagram', split: 'Split', decision: 'Agent Decision', transform: 'Transform', review: 'Human Review', validation: 'Validation', output: 'Output' }
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
const maximumNodes = 400
const maximumEdges = 800
export const proposalCardCompatibility: Record<ProposalCardKind, readonly ProposalCardKind[]> = {
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

export function proposalConnectionCompatibilityError(source: ProposalCardKind, target: ProposalCardKind, sourceHandle: string | null) {
  if (source === 'control' || target === 'control') return 'SAM LAB Control is a global policy and cannot enter lineage'
  if (source === 'explorer' || target === 'explorer') return 'Catalog Explorer is a host-owned sidecar and cannot enter lineage'
  if (target === 'source') return 'Data Source must begin a lineage path'
  if (source === 'output') return sourceHandle === 'feedback' && target === 'monitor' ? undefined : 'Output can connect only to Live Monitor through feedback'
  if (sourceHandle === 'feedback') return 'feedback is reserved for Output → Live Monitor'
  if (source === 'split' && !['approved', 'quarantine'].includes(sourceHandle ?? '')) return 'Split edges require approved or quarantine'
  if (source !== 'split' && (sourceHandle === 'approved' || sourceHandle === 'quarantine')) return 'approved and quarantine are reserved for Split'
  if (!proposalCardCompatibility[source].includes(target)) return `${source} cannot connect to ${target}`
  return undefined
}

export function riskAssessmentRuleError(rule: string | null): string | undefined {
  const normalizedRule = rule?.toLowerCase()
  if (!normalizedRule || !['scope=', 'risk_type=', 'severity=', 'confidence=', 'evidence=', 'affected_assets=', 'action='].every((field) => normalizedRule.includes(field))) {
    return 'Risk Assessment requires scope, risk_type, severity, confidence, evidence, affected_assets and action'
  }
  const value = (key: string) => normalizedRule.match(new RegExp(`(?:^|\\|)\\s*${key}\\s*=\\s*([^|]+)`, 'i'))?.[1].trim().toLowerCase()
  const scope = value('scope')
  const riskDomain = value('risk_domain')
  const riskType = value('risk_type')
  const severity = value('severity')
  const evidence = value('evidence')
  const confidence = Number(value('confidence'))
  const affectedAssets = Number(value('affected_assets'))
  const affectedModelsValue = value('affected_models')
  const affectedModels = affectedModelsValue === undefined ? undefined : Number(affectedModelsValue)
  const action = value('action')
  if (!scope || !action) return 'Risk Assessment scope and action must be non-empty'
  if (riskDomain && !['general', 'data', 'ml', 'analytics', 'privacy', 'governance', 'security', 'reliability'].includes(riskDomain)) return 'Risk Assessment risk_domain is invalid'
  if (!['data', 'collection', 'none'].includes(riskType ?? '')) return 'Risk Assessment risk_type must be data, collection or none'
  if (!['critical', 'high', 'medium', 'low', 'unknown'].includes(severity ?? '')) return 'Risk Assessment severity is invalid'
  if (!['fresh', 'stale', 'unavailable'].includes(evidence ?? '')) return 'Risk Assessment evidence is invalid'
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 'Risk Assessment confidence must be between 0 and 1'
  if (!Number.isInteger(affectedAssets) || affectedAssets < 0) return 'Risk Assessment affected_assets must be a non-negative integer'
  if (affectedModels !== undefined && (!Number.isInteger(affectedModels) || affectedModels < 0)) return 'Risk Assessment affected_models must be a non-negative integer'
  if (riskType === 'data' && evidence !== 'fresh') return 'Data risk requires fresh versioned evidence; connector failures must use risk_type=collection'
  if (riskType === 'data' && (severity === 'unknown' || affectedAssets === 0)) return 'Data risk requires a concrete severity and at least one affected asset'
  if (riskType === 'collection' && affectedAssets > 0) return 'Collection reliability cannot claim affected data assets'
  if (riskType === 'none' && (affectedAssets > 0 || !['unknown', 'low'].includes(severity ?? ''))) return 'risk_type=none cannot claim affected assets or elevated severity'
  return undefined
}

export function queryCheckRuleError(rule: string | null): string | undefined {
  const values = new Map((rule ?? '').split(/\s*\|\s*/).flatMap((clause) => {
    const match = clause.match(/^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i)
    return match ? [[match[1].toLowerCase(), match[2].trim().toLowerCase()] as const] : []
  }))
  const connector = values.get('connector') ?? ''
  const operation = values.get('operation') ?? ''
  const mode = values.get('mode')
  const timeout = Number(values.get('timeout_ms'))
  const writeOperation = operation.endsWith('.write') || operation.endsWith('.update')
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(connector)) return 'Query Check requires a safe connector ID'
  if (values.get('protocol') !== 'graphql') return 'Query Check supports protocol=graphql'
  if (values.get('registry') !== 'connector_manifest') return 'Query Check operation must resolve through registry=connector_manifest'
  if (!['catalog.search', 'entity.read', 'schema.read', 'lineage.read', 'profile.read', 'document.write', 'metadata.update'].includes(operation)) return 'Query Check operation is not registered'
  if (!['read_only', 'governed_write'].includes(mode ?? '')) return 'Query Check mode must be read_only or governed_write'
  if (values.get('variables') !== 'host_validated') return 'Query Check variables must be host_validated'
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 30_000) return 'Query Check timeout_ms must be between 1000 and 30000'
  if (/__schema|__type/i.test(rule ?? '')) return 'Query Check forbids free GraphQL introspection'
  if (writeOperation && (mode !== 'governed_write' || values.get('review') !== 'required' || values.get('dry_run') !== 'required' || values.get('rollback') !== 'versioned' || values.get('response') !== 'mutation_receipt')) {
    return 'Governed writes require Human Review, dry-run, versioned rollback and a mutation receipt'
  }
  const aggregateRead = operation === 'profile.read'
  const expectedReadResponse = aggregateRead ? 'bounded_aggregate_profile' : 'bounded_metadata'
  if (!writeOperation && (mode !== 'read_only' || values.get('review') !== 'not_required' || values.get('dry_run') !== 'not_applicable' || values.get('rollback') !== 'not_applicable' || values.get('response') !== expectedReadResponse)) {
    return aggregateRead
      ? 'profile.read requires read_only mode and a bounded aggregate profile response'
      : 'Read queries require read_only mode and a bounded metadata response'
  }
  return undefined
}

export function catalogExplorerRuleError(rule: string | null): string | undefined {
  const normalized = rule?.toLowerCase() ?? ''
  const scope = normalized.match(/(?:^|\|)\s*scope\s*=\s*([^|]+)/)?.[1]?.trim()
  if (!['dataset', 'all_datasets'].includes(scope ?? '')) return 'Catalog Explorer scope must be dataset or all_datasets'
  if (scope === 'dataset' && !/(?:^|\|)\s*dataset_urn\s*=\s*\S+/.test(normalized)) return 'Focused Catalog Explorer requires dataset_urn'
  const batchSize = Number(normalized.match(/(?:^|\|)\s*batch_size\s*=\s*(\d+)/)?.[1])
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32) return 'Catalog Explorer batch_size must be between 1 and 32'
  const concurrency = Number(normalized.match(/(?:^|\|)\s*audit_concurrency\s*=\s*(\d+)/)?.[1])
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return 'Catalog Explorer audit_concurrency must be between 1 and 8'
  if (!/(?:^|\|)\s*cache\s*=\s*(prefer|refresh)\b/.test(normalized)) return 'Catalog Explorer cache must be prefer or refresh'
  if (!/(?:^|\|)\s*checkpoint\s*=\s*versioned\b/.test(normalized)) return 'Catalog Explorer requires checkpoint=versioned'
  if (!/(?:^|\|)\s*resume\s*=\s*true\b/.test(normalized)) return 'Catalog Explorer requires resume=true'
  return undefined
}

export function workerPolicyError(rule: string | null | undefined): string | undefined {
  const normalized = rule?.toLowerCase() ?? ''
  const role = normalized.match(/(?:^|\|)\s*role\s*=\s*([^|]+)/)?.[1]?.trim()
  if (!['exploration', 'audit', 'risk', 'incident', 'patch', 'generic'].includes(role ?? '')) return 'Worker Node role is invalid'
  const batchSize = Number(normalized.match(/(?:^|\|)\s*batch_size\s*=\s*(\d+)/)?.[1])
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32) return 'Worker Node batch_size must be between 1 and 32'
  const concurrency = Number(normalized.match(/(?:^|\|)\s*max_concurrency\s*=\s*(\d+)/)?.[1])
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return 'Worker Node max_concurrency must be between 1 and 8'
  if (!/(?:^|\|)\s*retry\s*=\s*(checkpoint|none)\b/.test(normalized)) return 'Worker Node retry must be checkpoint or none'
  if (!/(?:^|\|)\s*context\s*=\s*branch_only\b/.test(normalized)) return 'Worker Node requires context=branch_only'
  if (!/(?:^|\|)\s*merge\s*=\s*atomic\b/.test(normalized)) return 'Worker Node requires merge=atomic'
  return undefined
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string) {
  const keys = Object.keys(value)
  const missing = expected.filter((key) => !(key in value))
  const unknown = keys.filter((key) => !expected.includes(key))
  if (missing.length || unknown.length) throw new Error(`${label} has invalid fields${missing.length ? ` · missing ${missing.join(', ')}` : ''}${unknown.length ? ` · unknown ${unknown.join(', ')}` : ''}`)
}

function text(value: unknown, label: string, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be ${nullable ? 'text or null' : 'text'}`)
  const result = value.trim()
  if (!result || result.length > maximum) throw new Error(`${label} must contain 1–${maximum} characters`)
  return result
}

function identifier(value: unknown, label: string, nullable = false): string | null {
  const result = text(value, label, 120, nullable)
  if (result !== null && !identifierPattern.test(result)) throw new Error(`${label} is not a safe identifier`)
  return result
}

function sourceHandle(value: unknown, label: string): 'approved' | 'quarantine' | 'feedback' | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be text or null`)
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (['', 'n/a', 'na', 'none', 'null', 'not-applicable'].includes(normalized)) return null
  if (normalized === 'approved' || normalized === 'quarantine' || normalized === 'feedback') return normalized
  const suffix = normalized.match(/^(approved|quarantine)-(?:branch|path|output|handle)$/)
  if (suffix) return suffix[1] as 'approved' | 'quarantine'
  const prefix = normalized.match(/^(?:branch|path|output|handle)-(approved|quarantine)$/)
  if (prefix) return prefix[1] as 'approved' | 'quarantine'
  throw new Error(`${label} must be null, approved, quarantine or feedback`)
}

function compactGraph(payload: unknown) {
  const input = record(payload, 'Agent request')
  const graph = record(input.graph, 'Agent request graph')
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Agent request graph must contain node and edge arrays')
  if (graph.nodes.length > maximumNodes || graph.edges.length > maximumEdges) throw new Error('Agent request graph exceeds the SAM LAB safety limits')
  const nodeIds = new Set<string>()
  const reviewNodeIds = new Set<string>()
  const riskNodeIds = new Set<string>()
  const explorerNodeIds = new Set<string>()
  const workerNodeIds = new Set<string>()
  const queryNodeIds = new Set<string>()
  const nodeKinds = new Map<string, ProposalCardKind>()
  for (const [index, item] of graph.nodes.entries()) {
    const node = record(item, `Graph node ${index + 1}`)
    const id = identifier(node.id, `Graph node ${index + 1} id`)!
    if (nodeIds.has(id)) throw new Error(`Graph contains duplicate node id ${id}`)
    nodeIds.add(id)
    if (node.kind === 'review') reviewNodeIds.add(id)
    if (node.kind === 'risk') riskNodeIds.add(id)
    if (node.kind === 'explorer') explorerNodeIds.add(id)
    if (node.kind === 'worker') workerNodeIds.add(id)
    if (node.kind === 'query') queryNodeIds.add(id)
    if (kinds.has(node.kind as ProposalCardKind)) nodeKinds.set(id, node.kind as ProposalCardKind)
  }
  const edgeIds = new Set<string>()
  for (const [index, item] of graph.edges.entries()) {
    const edge = record(item, `Graph edge ${index + 1}`)
    const id = identifier(edge.id, `Graph edge ${index + 1} id`)!
    if (edgeIds.has(id)) throw new Error(`Graph contains duplicate edge id ${id}`)
    edgeIds.add(id)
  }
  return { nodeIds, edgeIds, explorerNodeIds, reviewNodeIds, riskNodeIds, workerNodeIds, queryNodeIds, nodeKinds }
}

function validateAction(value: unknown, index: number): ValidatedProposalAction {
  const action = record(value, `Proposal action ${index + 1}`)
  exactKeys(action, actionKeys, `Proposal action ${index + 1}`)
  if (!actionTypes.has(action.type as ProposalActionType)) throw new Error(`Proposal action ${index + 1} has an unknown type`)
  if (action.kind !== null && !kinds.has(action.kind as ProposalCardKind)) throw new Error(`Proposal action ${index + 1} has an unknown card kind`)
  return {
    type: action.type as ProposalActionType,
    node_id: identifier(action.node_id, `Proposal action ${index + 1} node_id`, true),
    kind: action.kind as ProposalCardKind | null,
    label: text(action.label, `Proposal action ${index + 1} label`, 120, true),
    description: text(action.description, `Proposal action ${index + 1} description`, 500, true),
    owner: text(action.owner, `Proposal action ${index + 1} owner`, 120, true),
    rule: text(action.rule, `Proposal action ${index + 1} rule`, 2_000, true),
    source: identifier(action.source, `Proposal action ${index + 1} source`, true),
    target: identifier(action.target, `Proposal action ${index + 1} target`, true),
    source_handle: sourceHandle(action.source_handle, `Proposal action ${index + 1} source_handle`),
    reason: text(action.reason, `Proposal action ${index + 1} reason`, 500)!,
  }
}

function requireNull(action: ValidatedProposalAction, fields: Array<keyof ValidatedProposalAction>, index: number) {
  for (const field of fields) if (action[field] !== null) throw new Error(`Proposal action ${index + 1} must leave ${field} null`)
}

export function validateProposal(value: unknown, payload: unknown): ValidatedProposal {
  const proposal = record(value, 'Provider proposal')
  exactKeys(proposal, rootKeys, 'Provider proposal')
  if (typeof proposal.requires_human_review !== 'boolean') throw new Error('requires_human_review must be boolean')
  if (typeof proposal.confidence !== 'number' || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) throw new Error('confidence must be a finite number between 0 and 1')
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length > 12) throw new Error('evidence must contain at most 12 entries')
  if (!Array.isArray(proposal.actions) || proposal.actions.length > 20) throw new Error('actions must contain at most 20 entries')

  const { nodeIds, edgeIds, explorerNodeIds, reviewNodeIds, riskNodeIds, workerNodeIds, queryNodeIds, nodeKinds } = compactGraph(payload)
  const actions = proposal.actions.map(validateAction)
  const virtualKinds = new Map(nodeKinds)
  for (const action of actions) {
    if (action.type === 'add_card' && action.node_id && action.kind) virtualKinds.set(action.node_id, action.kind)
    if (action.type === 'update_card' && action.node_id && action.kind) virtualKinds.set(action.node_id, action.kind)
  }
  const allExplorerNodeIds = new Set([
    ...explorerNodeIds,
    ...actions.flatMap((action) => action.type === 'add_card' && action.kind === 'explorer' && action.node_id ? [action.node_id] : []),
  ])
  const aliases = new Set<string>()
  const removedEdges = new Set<string>()
  let addedEdgeCount = 0

  for (const [index, action] of actions.entries()) {
    if (action.type === 'add_card') {
      if (!action.node_id || !action.kind) throw new Error(`Proposal action ${index + 1} add_card requires a safe node_id and card kind`)
      action.label ??= cardNames[action.kind]
      action.description ??= `Agent-proposed ${cardNames[action.kind]} awaiting graph review.`
      action.owner ??= 'SAM LAB Agent'
      requireNull(action, ['source', 'target', 'source_handle'], index)
      if (action.kind === 'risk') {
        const error = riskAssessmentRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if (action.kind === 'explorer') {
        const error = catalogExplorerRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if (action.kind === 'worker') {
        const error = workerPolicyError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if (action.kind === 'query') {
        const error = queryCheckRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if (nodeIds.has(action.node_id) || aliases.has(action.node_id)) throw new Error(`Proposal contains duplicate node id ${action.node_id}`)
      aliases.add(action.node_id)
      continue
    }
    if (action.type === 'update_card') {
      if (!action.node_id || !nodeIds.has(action.node_id)) throw new Error(`Proposal action ${index + 1} references an unknown card`)
      requireNull(action, ['source', 'target', 'source_handle'], index)
      if ((action.kind === 'risk' || riskNodeIds.has(action.node_id)) && (action.kind === 'risk' || action.rule !== null)) {
        const error = riskAssessmentRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if ((action.kind === 'explorer' || explorerNodeIds.has(action.node_id)) && (action.kind === 'explorer' || action.rule !== null)) {
        const error = catalogExplorerRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if ((action.kind === 'worker' || workerNodeIds.has(action.node_id)) && (action.kind === 'worker' || action.rule !== null)) {
        const error = workerPolicyError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      if ((action.kind === 'query' || queryNodeIds.has(action.node_id)) && (action.kind === 'query' || action.rule !== null)) {
        const error = queryCheckRuleError(action.rule)
        if (error) throw new Error(`Proposal action ${index + 1} · ${error}`)
      }
      continue
    }
    if (action.type === 'remove_edge') {
      if (!action.node_id || !edgeIds.has(action.node_id) || removedEdges.has(action.node_id)) throw new Error(`Proposal action ${index + 1} references an unknown or duplicate edge removal`)
      requireNull(action, ['kind', 'label', 'description', 'owner', 'rule', 'source', 'target', 'source_handle'], index)
      removedEdges.add(action.node_id)
      continue
    }
    if (!action.source || !action.target || action.source === action.target) throw new Error(`Proposal action ${index + 1} has invalid edge endpoints`)
    requireNull(action, ['node_id', 'kind', 'label', 'description', 'owner', 'rule'], index)
    if ((!nodeIds.has(action.source) && !aliases.has(action.source)) || (!nodeIds.has(action.target) && !aliases.has(action.target))) throw new Error(`Proposal action ${index + 1} contains a dangling edge`)
    if (allExplorerNodeIds.has(action.source) || allExplorerNodeIds.has(action.target)) throw new Error(`Proposal action ${index + 1} cannot connect the host-owned Catalog Explorer sidecar to dataset lineage`)
    if (action.source_handle && !['approved', 'quarantine', 'feedback'].includes(action.source_handle)) throw new Error(`Proposal action ${index + 1} has an invalid source handle`)
    const sourceKind = virtualKinds.get(action.source)
    const targetKind = virtualKinds.get(action.target)
    const compatibilityError = sourceKind && targetKind ? proposalConnectionCompatibilityError(sourceKind, targetKind, action.source_handle) : undefined
    if (compatibilityError) throw new Error(`Proposal action ${index + 1} · ${compatibilityError}`)
    addedEdgeCount += 1
  }

  if (nodeIds.size + aliases.size > maximumNodes || edgeIds.size - removedEdges.size + addedEdgeCount > maximumEdges) throw new Error('Proposal would grow the graph beyond the SAM LAB safety limits')
  const includesReview = actions.some((action) => action.kind === 'review' || (action.type === 'update_card' && Boolean(action.node_id && reviewNodeIds.has(action.node_id))))
  const includesGovernedQueryWrite = actions.some((action) =>
    action.rule !== null
    && /(?:^|\|)\s*mode\s*=\s*governed_write\b/i.test(action.rule)
    && (action.kind === 'query' || Boolean(action.node_id && queryNodeIds.has(action.node_id))))
  if (includesGovernedQueryWrite && !proposal.requires_human_review) throw new Error('Governed Query Check writes require requires_human_review=true and a Human Review card action')
  if (proposal.requires_human_review && !includesReview) throw new Error('Human Review was requested without a Human Review card action')
  if (!proposal.requires_human_review && includesReview) throw new Error('Human Review card actions require requires_human_review=true')
  const request = record(payload, 'Agent request')
  if (request.mode === 'review-assistant' && actions.length) throw new Error('Human Review assistant responses must contain zero graph actions')
  if (request.mode === 'review-assistant' && proposal.requires_human_review) throw new Error('Human Review assistant responses cannot request another review')

  return {
    title: text(proposal.title, 'title', 160)!,
    summary: text(proposal.summary, 'summary', 800)!,
    rationale: text(proposal.rationale, 'rationale', 1_600)!,
    requires_human_review: proposal.requires_human_review,
    confidence: proposal.confidence,
    writeback: text(proposal.writeback, 'writeback', 800)!,
    evidence: proposal.evidence.map((item, index) => text(item, `evidence ${index + 1}`, 500)!),
    actions,
  }
}

export function parseAndValidateProposal(value: string, payload: unknown): ValidatedProposal {
  if (value.length > 120_000) throw new Error('Provider proposal exceeds the 120 KB safety limit')
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error('Provider returned malformed JSON') }
  return validateProposal(parsed, payload)
}
