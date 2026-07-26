export const queryCheckOperations = ['catalog.search', 'entity.read', 'schema.read', 'lineage.read', 'profile.read', 'document.write', 'metadata.update'] as const

export type QueryCheckOperation = typeof queryCheckOperations[number]

export interface QueryCheckPolicy {
  connector: string
  protocol: 'graphql' | undefined
  operation: QueryCheckOperation | undefined
  mode: 'read_only' | 'governed_write' | undefined
  variables: 'host_validated' | undefined
  registry: 'connector_manifest' | undefined
  timeoutMs: number | undefined
  review: 'required' | 'not_required' | undefined
  dryRun: 'required' | 'not_applicable' | undefined
  rollback: 'versioned' | 'not_applicable' | undefined
  response: 'bounded_metadata' | 'bounded_aggregate_profile' | 'mutation_receipt' | undefined
  complete: boolean
}

export const defaultQueryCheckRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=profile.read | mode=read_only | variables=host_validated | timeout_ms=8000 | review=not_required | dry_run=not_applicable | rollback=not_applicable | response=bounded_aggregate_profile'

function clauses(rule: string | undefined) {
  return new Map((rule ?? '').split(/\s*\|\s*/).flatMap((clause) => {
    const match = clause.match(/^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i)
    return match ? [[match[1].toLowerCase(), match[2].trim()]] as const : []
  }))
}

export function parseQueryCheckRule(rule: string | undefined): QueryCheckPolicy {
  const values = clauses(rule)
  const rawOperation = values.get('operation')?.toLowerCase() as QueryCheckOperation | undefined
  const timeoutMs = Number(values.get('timeout_ms'))
  const policy: QueryCheckPolicy = {
    connector: values.get('connector') ?? '',
    protocol: values.get('protocol')?.toLowerCase() === 'graphql' ? 'graphql' : undefined,
    operation: rawOperation && queryCheckOperations.includes(rawOperation) ? rawOperation : undefined,
    mode: ['read_only', 'governed_write'].includes(values.get('mode')?.toLowerCase() ?? '')
      ? values.get('mode')?.toLowerCase() as QueryCheckPolicy['mode']
      : undefined,
    variables: values.get('variables')?.toLowerCase() === 'host_validated' ? 'host_validated' : undefined,
    registry: values.get('registry')?.toLowerCase() === 'connector_manifest' ? 'connector_manifest' : undefined,
    timeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 30_000 ? timeoutMs : undefined,
    review: ['required', 'not_required'].includes(values.get('review')?.toLowerCase() ?? '')
      ? values.get('review')?.toLowerCase() as QueryCheckPolicy['review']
      : undefined,
    dryRun: ['required', 'not_applicable'].includes(values.get('dry_run')?.toLowerCase() ?? '')
      ? values.get('dry_run')?.toLowerCase() as QueryCheckPolicy['dryRun']
      : undefined,
    rollback: ['versioned', 'not_applicable'].includes(values.get('rollback')?.toLowerCase() ?? '')
      ? values.get('rollback')?.toLowerCase() as QueryCheckPolicy['rollback']
      : undefined,
    response: ['bounded_metadata', 'bounded_aggregate_profile', 'mutation_receipt'].includes(values.get('response')?.toLowerCase() ?? '')
      ? values.get('response')?.toLowerCase() as QueryCheckPolicy['response']
      : undefined,
    complete: false,
  }
  policy.complete = Boolean(/^[a-z][a-z0-9-]{1,31}$/i.test(policy.connector)
    && policy.protocol
    && policy.operation
    && policy.mode
    && policy.variables
    && policy.registry
    && policy.timeoutMs
    && policy.review
    && policy.dryRun
    && policy.rollback
    && policy.response)
  return policy
}

export function queryCheckRuleError(rule: string | undefined) {
  const policy = parseQueryCheckRule(rule)
  if (!/^[a-z][a-z0-9-]{1,31}$/i.test(policy.connector)) return 'Query Check requires a safe connector ID.'
  if (!policy.protocol) return 'Query Check supports the GraphQL protocol only.'
  if (!policy.operation) return `Choose one registered operation: ${queryCheckOperations.join(', ')}.`
  if (!policy.mode) return 'Query Check mode must be read_only or governed_write.'
  if (!policy.variables) return 'Query variables must be validated by the SAM LAB host.'
  if (!policy.registry) return 'Query operation must resolve through the connector manifest.'
  if (!policy.timeoutMs) return 'Query timeout must be between 1000 and 30000 milliseconds.'
  if (!policy.review || !policy.dryRun || !policy.rollback || !policy.response) return 'Query Check requires review, dry_run, rollback and response policies.'
  const writeOperation = policy.operation.endsWith('.write') || policy.operation.endsWith('.update')
  if (writeOperation && policy.mode !== 'governed_write') return 'Registered write operations require mode=governed_write.'
  if (writeOperation && (policy.review !== 'required' || policy.dryRun !== 'required' || policy.rollback !== 'versioned' || policy.response !== 'mutation_receipt')) {
    return 'Governed writes require Human Review, dry-run, versioned rollback and a mutation receipt.'
  }
  const aggregateRead = policy.operation === 'profile.read'
  const expectedReadResponse = aggregateRead ? 'bounded_aggregate_profile' : 'bounded_metadata'
  if (!writeOperation && (policy.mode !== 'read_only' || policy.review !== 'not_required' || policy.dryRun !== 'not_applicable' || policy.rollback !== 'not_applicable' || policy.response !== expectedReadResponse)) {
    return aggregateRead
      ? 'profile.read requires read_only mode and a bounded aggregate profile response.'
      : 'Metadata reads require read_only mode and a bounded metadata response.'
  }
  if (/__schema|__type/i.test(rule ?? '')) return 'Free GraphQL introspection is forbidden in Query Check.'
  return undefined
}
