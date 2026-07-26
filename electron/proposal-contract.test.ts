import { describe, expect, it } from 'vitest'
import { parseAndValidateProposal, validateProposal } from './proposal-contract.js'

const payload = {
  graph: {
    nodes: [
      { id: 'source-1', kind: 'source' },
      { id: 'output-1', kind: 'output' },
    ],
    edges: [{ id: 'edge-1', source: 'source-1', target: 'output-1' }],
  },
}

const emptyFields = { kind: null, label: null, description: null, owner: null, rule: null, source: null, target: null, source_handle: null }
const validProposal = {
  title: 'Mask the sensitive field',
  summary: 'Insert a reviewed masking transform.',
  rationale: 'DataHub classifies email as PII.',
  requires_human_review: true,
  confidence: 0.9,
  writeback: 'Record the approved masking decision.',
  evidence: ['get_entities · PII email'],
  actions: [
    { type: 'add_card', node_id: 'mask-email', kind: 'transform', label: 'Mask email', description: 'Hashes email before activation.', owner: 'Data team', rule: 'sha256(email)', source: null, target: null, source_handle: null, reason: 'Protect PII.' },
    { type: 'add_card', node_id: 'review-mask', kind: 'review', label: 'Review masking', description: 'Approve the sensitive-data change.', owner: 'Privacy', rule: null, source: null, target: null, source_handle: null, reason: 'Sensitive change.' },
    { type: 'remove_edge', node_id: 'edge-1', ...emptyFields, reason: 'Replace direct path.' },
    { type: 'add_edge', node_id: null, kind: null, label: null, description: null, owner: null, rule: null, source: 'source-1', target: 'mask-email', source_handle: null, reason: 'Route through masking.' },
  ],
}

describe('strict provider proposal contract', () => {
  it('accepts a bounded, complete and internally consistent proposal', () => {
    expect(validateProposal(validProposal, payload)).toEqual(validProposal)
  })

  it('repairs only non-structural add-card metadata when the provider returns null', () => {
    const incompleteMetadata = { ...validProposal, actions: [{ ...validProposal.actions[0], label: null, description: null, owner: null }, validProposal.actions[1]] }
    const result = validateProposal(incompleteMetadata, payload)
    expect(result.actions[0]).toMatchObject({ node_id: 'mask-email', kind: 'transform', label: 'Transform', description: 'Agent-proposed Transform awaiting graph review.', owner: 'SAM LAB Agent' })
  })

  it('accepts Data Profile as bounded agent memory', () => {
    const profile = { ...validProposal.actions[0], node_id: 'customers-profile', kind: 'profile', label: 'Customers profile', description: 'Compact schema and quality memory.', rule: '40 fields · 1 sensitive · fresh' }
    const result = validateProposal({ ...validProposal, requires_human_review: false, actions: [profile] }, payload)
    expect(result.actions[0]).toMatchObject({ node_id: 'customers-profile', kind: 'profile' })
  })

  it('accepts only a complete bounded Catalog Explorer policy', () => {
    const explorer = { ...validProposal.actions[0], node_id: 'catalog-explorer', kind: 'explorer', label: 'Catalog Explorer', rule: 'scope=all_datasets | batch_size=8 | audit_concurrency=4 | cache=prefer | checkpoint=versioned | resume=true' }
    expect(validateProposal({ ...validProposal, requires_human_review: false, actions: [explorer] }, payload).actions[0].kind).toBe('explorer')
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [{ ...explorer, rule: 'scope=all_datasets | batch_size=8 | audit_concurrency=99 | cache=prefer | checkpoint=versioned | resume=true' }] }, payload)).toThrow('audit_concurrency')
  })

  it('accepts a generic bounded Worker Node and rejects unbounded concurrency', () => {
    const worker = { ...validProposal.actions[0], node_id: 'worker-audit', kind: 'worker', label: 'Audit worker', rule: 'role=audit | batch_size=8 | max_concurrency=4 | retry=checkpoint | context=branch_only | merge=atomic' }
    expect(validateProposal({ ...validProposal, requires_human_review: false, actions: [worker] }, payload).actions[0].kind).toBe('worker')
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [{ ...worker, rule: 'role=audit | batch_size=8 | max_concurrency=99 | retry=checkpoint | context=branch_only | merge=atomic' }] }, payload)).toThrow('max_concurrency')
  })

  it('accepts registered Query Check reads and requires review for governed writes', () => {
    const readRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=entity.read | mode=read_only | variables=host_validated | timeout_ms=8000 | review=not_required | dry_run=not_applicable | rollback=not_applicable | response=bounded_metadata'
    const read = { ...validProposal.actions[0], node_id: 'query-read', kind: 'query', label: 'Verify entity read', rule: readRule }
    expect(validateProposal({ ...validProposal, requires_human_review: false, actions: [read] }, payload).actions[0].kind).toBe('query')

    const aggregateRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=profile.read | mode=read_only | variables=host_validated | timeout_ms=8000 | review=not_required | dry_run=not_applicable | rollback=not_applicable | response=bounded_aggregate_profile'
    const aggregateRead = { ...read, node_id: 'query-profile', label: 'Audit aggregate values', rule: aggregateRule }
    expect(validateProposal({ ...validProposal, requires_human_review: false, actions: [aggregateRead] }, payload).actions[0].kind).toBe('query')

    const writeRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=metadata.update | mode=governed_write | variables=host_validated | timeout_ms=8000 | review=required | dry_run=required | rollback=versioned | response=mutation_receipt'
    const write = { ...read, node_id: 'query-write', label: 'Verify metadata update', rule: writeRule }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [write] }, payload)).toThrow('requires_human_review=true')
    expect(validateProposal({ ...validProposal, requires_human_review: true, actions: [write, validProposal.actions[1]] }, payload).actions[0].kind).toBe('query')
  })

  it('enforces semantic edge compatibility in provider proposals', () => {
    const profile = { ...validProposal.actions[0], node_id: 'profile-a', kind: 'profile', label: 'Profile A' }
    const transform = { ...validProposal.actions[0], node_id: 'transform-a', kind: 'transform', label: 'Transform A' }
    const edge = { ...validProposal.actions[3], source: 'profile-a', target: 'transform-a' }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [profile, transform, edge] }, payload)).toThrow('profile cannot connect to transform')
  })

  it('rejects lineage edges to the host-owned Catalog Explorer sidecar', () => {
    const explorer = { ...validProposal.actions[0], node_id: 'catalog-explorer', kind: 'explorer', label: 'Catalog Explorer', rule: 'scope=all_datasets | batch_size=8 | audit_concurrency=4 | cache=prefer | checkpoint=versioned | resume=true' }
    const source = { ...validProposal.actions[0], node_id: 'orders-source', kind: 'source', label: 'Orders' }
    const edge = { ...validProposal.actions[3], source: 'catalog-explorer', target: 'orders-source' }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [explorer, source, edge] }, payload)).toThrow('host-owned Catalog Explorer')
  })

  it('rejects a Human Review checkpoint when the provider forgets the review flag', () => {
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [validProposal.actions[1]] }, payload)).toThrow('require requires_human_review=true')
  })

  it('rejects an existing Human Review update when the provider forgets the review flag', () => {
    const graphWithReview = { graph: { nodes: [...payload.graph.nodes, { id: 'review-existing', kind: 'review' }], edges: payload.graph.edges } }
    const update = { ...validProposal.actions[0], type: 'update_card', node_id: 'review-existing', kind: null }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [update] }, graphWithReview)).toThrow('require requires_human_review=true')
  })

  it('accepts multiple scoped Impact Analysis atoms', () => {
    const featureImpact = { ...validProposal.actions[0], node_id: 'feature-impact', kind: 'impact', label: 'Feature impact', rule: 'scope(customer_age) → customer_features' }
    const modelImpact = { ...validProposal.actions[0], node_id: 'model-impact', kind: 'impact', label: 'Model impact', rule: 'scope(customer_features) → churn_prediction_v3' }
    const result = validateProposal({ ...validProposal, requires_human_review: false, actions: [featureImpact, modelImpact] }, payload)
    expect(result.actions.map((action) => action.kind)).toEqual(['impact', 'impact'])
  })

  it('accepts an evidence-backed Risk Assessment atom', () => {
    const risk = { ...validProposal.actions[0], node_id: 'model-risk', kind: 'risk', label: 'Churn model risk', rule: 'scope=churn_model_v3 | risk_type=data | severity=high | confidence=0.9 | evidence=fresh | affected_assets=3 | action=retrain' }
    const result = validateProposal({ ...validProposal, requires_human_review: false, actions: [risk] }, payload)
    expect(result.actions[0]).toMatchObject({ node_id: 'model-risk', kind: 'risk' })
  })

  it.each([
    ['missing rule', null, 'requires scope'],
    ['empty scope', 'scope= | risk_type=data | severity=high | confidence=0.9 | evidence=fresh | affected_assets=3 | action=retrain', 'scope and action must be non-empty'],
    ['empty action', 'scope=churn_model_v3 | risk_type=data | severity=high | confidence=0.9 | evidence=fresh | affected_assets=3 | action=', 'scope and action must be non-empty'],
    ['stale data claim', 'scope=churn_model_v3 | risk_type=data | severity=high | confidence=0.9 | evidence=stale | affected_assets=3 | action=retrain', 'Data risk requires fresh'],
    ['collection failure claiming assets', 'scope=churn_model_v3 | risk_type=collection | severity=high | confidence=0.9 | evidence=unavailable | affected_assets=3 | action=repair_connector', 'cannot claim affected data assets'],
  ])('rejects provider Risk Assessment with %s', (_label, rule, message) => {
    const risk = { ...validProposal.actions[0], node_id: 'model-risk', kind: 'risk', label: 'Churn model risk', rule }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [risk] }, payload)).toThrow(message)
  })

  it('validates rule edits to an existing Risk Assessment without blocking metadata-only updates', () => {
    const graphWithRisk = { graph: { nodes: [...payload.graph.nodes, { id: 'risk-existing', kind: 'risk' }], edges: payload.graph.edges } }
    const metadataOnly = { ...validProposal.actions[0], type: 'update_card', node_id: 'risk-existing', kind: null, rule: null, label: 'Renamed risk' }
    expect(validateProposal({ ...validProposal, requires_human_review: false, actions: [metadataOnly] }, graphWithRisk).actions[0].label).toBe('Renamed risk')
    const unsafeRule = { ...metadataOnly, label: null, rule: 'scope=model | risk_type=data | severity=high | confidence=0.8 | evidence=unavailable | affected_assets=1 | action=stop' }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [unsafeRule] }, graphWithRisk)).toThrow('Data risk requires fresh')
  })

  it('accepts graph-only patches, live monitors, parallel agents and incident diagrams', () => {
    const patch = { ...validProposal.actions[0], node_id: 'compatibility-patch', kind: 'patch', label: 'Map legacy customer age', rule: 'graph_only: cast customer_age to number' }
    const monitor = { ...validProposal.actions[0], node_id: 'live-monitor', kind: 'monitor', label: 'Watch metadata drift', rule: 'on_change(metadata_fingerprint) | cooldown=60s | max_iterations=10' }
    const parallel = { ...validProposal.actions[0], node_id: 'parallel-agents', kind: 'parallel', label: 'Inspect independent impacts', rule: 'max_concurrency=3 | context=branch_only | merge=atomic' }
    const diagram = { ...validProposal.actions[0], node_id: 'incident-diagram', kind: 'diagram', label: 'Relate incident branches', rule: 'group=incident | inputs=parallel_diffs | merge=atomic' }
    const result = validateProposal({ ...validProposal, requires_human_review: false, actions: [patch, monitor, parallel, diagram] }, payload)
    expect(result.actions.map((action) => action.kind)).toEqual(['patch', 'monitor', 'parallel', 'diagram'])
  })

  it('accepts a feedback edge only as an explicit source handle value', () => {
    const monitor = { ...validProposal.actions[0], node_id: 'live-monitor', kind: 'monitor', label: 'Watch metadata drift' }
    const feedback = { ...validProposal.actions[3], source: 'output-1', target: 'live-monitor', source_handle: 'feedback' }
    const result = validateProposal({ ...validProposal, requires_human_review: false, actions: [monitor, feedback] }, payload)
    expect(result.actions[1].source_handle).toBe('feedback')
  })

  it('normalizes unambiguous provider source-handle aliases without weakening split routing', () => {
    const split = { ...validProposal.actions[0], node_id: 'route-risk', kind: 'split', label: 'Route risk' }
    const approvedEdge = { ...validProposal.actions[3], source: 'route-risk', target: 'output-1', source_handle: 'Approved branch' }
    const nullablePlaceholder = { ...validProposal.actions[1], source_handle: 'N/A' }
    const result = validateProposal({ ...validProposal, actions: [split, nullablePlaceholder, approvedEdge] }, payload)
    expect(result.actions[1].source_handle).toBeNull()
    expect(result.actions[2].source_handle).toBe('approved')
  })

  it('rejects ambiguous or executable-looking source handles', () => {
    const unsafe = { ...validProposal.actions[3], source_handle: 'approved; delete graph' }
    expect(() => validateProposal({ ...validProposal, actions: [validProposal.actions[1], unsafe] }, payload)).toThrow('must be null, approved, quarantine or feedback')
  })

  it.each([
    ['malformed JSON', '{"title":'],
    ['unknown root field', JSON.stringify({ ...validProposal, surprise: true })],
    ['partial action', JSON.stringify({ ...validProposal, actions: [{ type: 'add_card' }] })],
    ['unknown card kind', JSON.stringify({ ...validProposal, actions: [{ ...validProposal.actions[0], kind: 'shell' }, validProposal.actions[1]] })],
    ['duplicate node id', JSON.stringify({ ...validProposal, actions: [validProposal.actions[0], { ...validProposal.actions[0] }, validProposal.actions[1]] })],
    ['dangling edge', JSON.stringify({ ...validProposal, actions: [validProposal.actions[1], { ...validProposal.actions[3], source: 'missing' }] })],
    ['invalid split handle', JSON.stringify({ ...validProposal, actions: [validProposal.actions[1], { ...validProposal.actions[3], source_handle: 'maybe' }] })],
    ['oversized title', JSON.stringify({ ...validProposal, title: 'x'.repeat(161) })],
    ['too many actions', JSON.stringify({ ...validProposal, actions: Array.from({ length: 21 }, () => validProposal.actions[0]) })],
  ])('rejects fuzz case: %s', (_label, serialized) => {
    expect(() => parseAndValidateProposal(serialized, payload)).toThrow()
  })

  it('leaves the current graph byte-for-byte unchanged after every rejected response', () => {
    const before = structuredClone(payload)
    const invalid = { ...validProposal, actions: [{ ...validProposal.actions[3], target: 'unknown-card' }] }
    expect(() => validateProposal(invalid, payload)).toThrow('dangling edge')
    expect(payload).toEqual(before)
  })

  it('rejects requests whose existing graph already exceeds the safety boundary', () => {
    const oversized = { graph: { nodes: Array.from({ length: 401 }, (_, index) => ({ id: `node-${index}` })), edges: [] } }
    expect(() => validateProposal({ ...validProposal, requires_human_review: false, actions: [] }, oversized)).toThrow('safety limits')
  })
})
