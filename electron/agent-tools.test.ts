import { describe, expect, it } from 'vitest'
import { AgentToolSession, agentToolDefinitions } from './agent-tools.js'

const payload = {
  cardActivationPlan: [
    { kind: 'query', state: 'recommended', reason: 'The source needs aggregate evidence.' },
    { kind: 'risk', state: 'available', reason: 'No material risk evidence yet.' },
  ],
  graph: {
    nodes: [
      { id: 'source-1', kind: 'source', label: 'Customers' },
      { id: 'split-1', kind: 'split', label: 'Risk route' },
      { id: 'output-1', kind: 'output', label: 'Published dataset' },
    ],
    edges: [{ id: 'edge-1', source: 'source-1', target: 'output-1' }],
  },
}

describe('bounded SAM LAB agent tools', () => {
  it('publishes strict schemas with every property required', () => {
    for (const tool of agentToolDefinitions) {
      expect(tool.strict).toBe(true)
      expect(tool.parameters.additionalProperties).toBe(false)
      expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties))
    }
  })

  it('builds complete actions from small tool calls and finishes a valid review plan', () => {
    const session = new AgentToolSession(payload)
    expect(session.execute('list_card_kinds', {}).ok).toBe(true)
    expect(session.execute('add_card', {
      node_id: 'profile-1',
      kind: 'profile',
      label: 'Customer profile',
      description: null,
      owner: null,
      rule: 'schema=versioned',
      reason: 'Avoid repeated schema reconstruction.',
    }).ok).toBe(true)
    expect(session.execute('add_card', {
      node_id: 'review-1',
      kind: 'review',
      label: 'Verify profile evidence',
      description: null,
      owner: null,
      rule: null,
      reason: 'The evidence is stale.',
    }).ok).toBe(true)
    expect(session.execute('connect_cards', {
      source: 'source-1',
      target: 'profile-1',
      source_handle: null,
      reason: 'Profile the governed source.',
    }).ok).toBe(true)
    expect(session.execute('connect_cards', {
      source: 'profile-1',
      target: 'review-1',
      source_handle: null,
      reason: 'Pause this branch at a durable checkpoint.',
    }).ok).toBe(true)
    expect(session.execute('validate_plan', {}).ok).toBe(true)
    expect(session.execute('finish_plan', {
      title: 'Profile the governed source',
      summary: 'Add compact profile memory and a resumable review checkpoint.',
      rationale: 'The graph needs reusable evidence before transformation.',
      requires_human_review: true,
      confidence: 0.8,
      writeback: 'Commit locally after approval.',
      evidence: ['list_schema_fields · stale'],
    }).ok).toBe(true)

    expect(session.proposal?.actions[0]).toMatchObject({
      type: 'add_card',
      node_id: 'profile-1',
      description: 'Agent-proposed Data Profile awaiting graph review.',
      owner: 'SAM LAB Agent',
    })
    expect(session.proposal?.actions[1].rule).toContain('on_approve=resume_next_iteration')
    expect(session.trace.map((item) => item.tool)).toEqual([
      'list_card_kinds',
      'add_card',
      'add_card',
      'connect_cards',
      'connect_cards',
      'validate_plan',
      'finish_plan',
    ])
  })

  it('rejects unsafe handles without losing earlier queued work', () => {
    const session = new AgentToolSession(payload)
    const rejected = session.execute('connect_cards', {
      source: 'source-1',
      target: 'output-1',
      source_handle: 'approved',
      reason: 'Invalid split routing.',
    })
    expect(rejected).toMatchObject({ ok: false, status: 'rejected' })

    expect(session.execute('connect_cards', {
      source: 'split-1',
      target: 'output-1',
      source_handle: 'approved',
      reason: 'Use the explicit approved branch.',
    }).ok).toBe(true)
    expect(session.execute('validate_plan', {})).toMatchObject({ ok: true, action_count: 1 })
  })

  it('completes missing Live Monitor bounds inside agent tools', () => {
    const session = new AgentToolSession(payload)
    expect(session.execute('add_card', {
      node_id: 'monitor-orders',
      kind: 'monitor',
      label: 'Watch orders',
      description: 'Watch metadata changes.',
      owner: 'SAM LAB Agent',
      rule: 'alert=severity_increase',
      reason: 'Keep the source under observation.',
    }).ok).toBe(true)

    expect(session.execute('inspect_graph', { node_ids: ['monitor-orders'] }).queued_actions).toEqual([
      expect.objectContaining({
        kind: 'monitor',
        rule: expect.stringMatching(/on_change\(metadata_fingerprint\).*cooldown=60s.*max_iterations=10/),
      }),
    ])
  })

  it('exposes the host autonomy policy to tool-driven planning turns', () => {
    const session = new AgentToolSession({
      ...payload,
      autonomyPolicy: { humanReview: 'frequent', riskAnalysis: 'exhaustive', uncertainty: 'no-change' },
    })
    expect(session.execute('inspect_graph', { node_ids: [] }).autonomy_policy).toEqual({
      humanReview: 'frequent',
      riskAnalysis: 'exhaustive',
      uncertainty: 'no-change',
    })
  })

  it('supplies a non-claiming default Risk Assessment contract', () => {
    const session = new AgentToolSession(payload)
    expect(session.execute('add_card', {
      node_id: 'risk-orders',
      kind: 'risk',
      label: 'Orders risk',
      description: null,
      owner: null,
      rule: null,
      reason: 'Classify evidence separately from collection reliability.',
    }).ok).toBe(true)
    expect(session.execute('inspect_graph', { node_ids: ['risk-orders'] }).queued_actions).toEqual([
      expect.objectContaining({
        kind: 'risk',
        rule: 'scope=downstream_assets | risk_domain=general | risk_type=none | severity=unknown | confidence=0 | evidence=unavailable | affected_assets=0 | action=read_versioned_lineage',
      }),
    ])
  })

  it('supplies a bounded generic Worker Node policy', () => {
    const session = new AgentToolSession(payload)
    expect(session.execute('add_card', {
      node_id: 'worker-audit',
      kind: 'worker',
      label: 'Audit worker',
      description: null,
      owner: null,
      rule: null,
      reason: 'Process connected audit cards in deterministic batches.',
    }).ok).toBe(true)
    expect(session.execute('inspect_graph', { node_ids: ['worker-audit'] }).queued_actions).toEqual([
      expect.objectContaining({
        kind: 'worker',
        rule: 'role=generic | batch_size=4 | max_concurrency=4 | retry=checkpoint | context=branch_only | merge=atomic',
      }),
    ])
  })

  it('rejects a data risk inferred from an unavailable connector', () => {
    const session = new AgentToolSession(payload)
    expect(session.execute('add_card', {
      node_id: 'risk-orders',
      kind: 'risk',
      label: 'Orders risk',
      description: null,
      owner: null,
      rule: 'scope=orders_model | risk_type=data | severity=critical | confidence=0.9 | evidence=unavailable | affected_assets=2 | action=stop_model',
      reason: 'Classify the observed risk.',
    })).toMatchObject({
      ok: false,
      summary: 'Data risk requires fresh versioned evidence; connector failures must use risk_type=collection',
    })
  })

  it('deduplicates cooldown clauses while preserving the first explicit cadence', () => {
    const session = new AgentToolSession(payload)
    const result = session.execute('add_card', {
      node_id: 'monitor-hourly-orders',
      kind: 'monitor',
      label: 'Watch hourly orders',
      description: 'Watch metadata changes.',
      owner: 'SAM LAB Agent',
      rule: 'on_change(metadata_fingerprint) | cooldown=30m | max_iterations=1 | cooldown=60s',
      reason: 'Use the first explicitly selected monitoring cadence.',
    })

    expect(result).toMatchObject({
      ok: true,
      action: { rule: 'on_change(metadata_fingerprint) | cooldown=30m | max_iterations=1' },
    })
  })

  it('preserves an existing Live Monitor rule during metadata-only updates', () => {
    const session = new AgentToolSession({
      ...payload,
      graph: {
        ...payload.graph,
        nodes: [
          ...payload.graph.nodes,
          {
            id: 'monitor-orders',
            kind: 'monitor',
            label: 'Watch orders',
            rule: 'source=orders | alert=owner_change | on_change(metadata_fingerprint) | cooldown=15s | max_iterations=4',
          },
        ],
      },
    })

    expect(session.execute('update_card', {
      node_id: 'monitor-orders',
      kind: null,
      label: 'Watch governed orders',
      description: null,
      owner: null,
      rule: null,
      reason: 'Clarify the monitor label without changing its policy.',
    })).toMatchObject({
      ok: true,
      action: {
        type: 'update_card',
        node_id: 'monitor-orders',
        label: 'Watch governed orders',
        rule: null,
      },
    })
  })

  it('exposes host-owned incident context without granting an incident mutation tool', () => {
    const session = new AgentToolSession({
      ...payload,
      incidentContext: [{ incidentKey: 'live-monitor:monitor-1:dataset', status: 'investigating', occurrenceCount: 2, fingerprint: 'abc123' }],
    })
    expect(session.execute('inspect_incident_context', { incident_key: 'live-monitor:monitor-1:dataset' })).toMatchObject({
      ok: true,
      incidents: [{ status: 'investigating', occurrenceCount: 2 }],
    })
    expect(agentToolDefinitions.map((tool) => tool.name)).not.toContain('record_incident')
  })

  it('exposes a complete catalog checkpoint as terminal bounded evidence', () => {
    const session = new AgentToolSession({
      ...payload,
      catalogCheckpoints: [{
        explorerId: 'catalog-explorer',
        state: 'complete',
        inspected: 67,
        total: 67,
        remaining: 0,
        incidents: 0,
        governanceGaps: 63,
        terminal: true,
        recommendedSourceUrn: 'urn:order-details',
        restartPolicy: 'Do not restart discovery.',
        datasets: [{ urn: 'urn:order-details', name: 'order_details', status: 'warning', issues: ['owner missing'] }],
      }],
    })

    expect(session.execute('read_catalog_checkpoint', { explorer_id: 'catalog-explorer' })).toMatchObject({
      ok: true,
      checkpoints: [{
        state: 'complete',
        inspected: 67,
        total: 67,
        terminal: true,
        recommendedSourceUrn: 'urn:order-details',
      }],
      policy: {
        complete_is_terminal: true,
        must_not_restart_complete_checkpoint: true,
        raw_rows_exposed: false,
      },
    })
    expect(session.execute('inspect_graph', { node_ids: [] })).toMatchObject({
      catalog_checkpoints: [{
        explorerId: 'catalog-explorer',
        terminal: true,
        recommendedSourceUrn: 'urn:order-details',
      }],
    })
    expect(session.execute('validate_plan', {})).toMatchObject({
      ok: true,
      catalog_checkpoint_policy: expect.stringContaining('terminal'),
    })
  })

  it('exposes the complete card compatibility contract before planning', () => {
    const session = new AgentToolSession(payload)
    const result = session.execute('list_card_kinds', {})
    const cards = result.cards as Array<{
      kind: string
      role: string
      activation: string
      completion: string
      current_state: string
      current_reason: string
      accepts_from: string[]
      connects_to: string[]
      source_handles: string[]
    }>
    expect(cards.find((card) => card.kind === 'query')).toMatchObject({
      current_state: 'recommended',
      current_reason: 'The source needs aggregate evidence.',
      activation: expect.stringContaining('aggregate evidence'),
      completion: expect.stringContaining('host-validated operation'),
      accepts_from: expect.arrayContaining(['source', 'patch']),
      connects_to: expect.arrayContaining(['profile', 'risk', 'review']),
      source_handles: [],
    })
    expect(cards.every((card) => card.role && card.activation && card.completion)).toBe(true)
    expect(cards.find((card) => card.kind === 'split')?.source_handles).toEqual(['approved', 'quarantine'])
    expect(cards.find((card) => card.kind === 'output')?.source_handles).toEqual(['feedback'])
    expect(cards.find((card) => card.kind === 'control')?.connects_to).toEqual([])
    expect(result.catalog_policy).toMatchObject({
      complete_is_terminal: true,
      reopen_only_on: ['explicit_refresh', 'new_monitor_evidence'],
    })
  })

  it('requires a Human Review card before finishing a review-gated plan', () => {
    const session = new AgentToolSession(payload)
    session.execute('list_card_kinds', {})
    const first = session.execute('finish_plan', {
      title: 'Unsafe change',
      summary: 'A sensitive change needs review.',
      rationale: 'PII is affected.',
      requires_human_review: true,
      confidence: 0.5,
      writeback: 'Do not commit yet.',
      evidence: ['PII tag'],
    })
    expect(first).toMatchObject({ ok: false, status: 'rejected' })
    expect(session.finished).toBe(false)

    session.execute('add_card', {
      node_id: 'review-sensitive-change',
      kind: 'review',
      label: 'Approve sensitive change',
      description: null,
      owner: 'Privacy',
      rule: null,
      reason: 'Explicit approval is required.',
    })
    session.execute('validate_plan', {})
    expect(session.execute('finish_plan', {
      title: 'Safe checkpoint',
      summary: 'Pause the affected branch for review.',
      rationale: 'PII is affected.',
      requires_human_review: true,
      confidence: 0.5,
      writeback: 'Commit only after approval.',
      evidence: ['PII tag'],
    }).ok).toBe(true)
  })

  it('makes Human Review assistant turns physically read-only', () => {
    const session = new AgentToolSession({ ...payload, mode: 'review-assistant' })
    expect(session.execute('add_card', {
      node_id: 'forbidden-card',
      kind: 'analysis',
      label: 'Forbidden',
      description: null,
      owner: null,
      rule: null,
      reason: 'Attempt a mutation.',
    })).toMatchObject({ ok: false, status: 'rejected', summary: expect.stringContaining('read-only') })

    expect(session.execute('finish_plan', {
      title: 'Reviewer answer',
      summary: 'The evidence is incomplete.',
      rationale: 'A fresh schema read is required before approval.',
      requires_human_review: false,
      confidence: 0.9,
      writeback: 'No action; advice only.',
      evidence: ['Schema read timed out'],
    })).toMatchObject({ ok: true })
    expect(session.proposal?.actions).toEqual([])
  })
})
