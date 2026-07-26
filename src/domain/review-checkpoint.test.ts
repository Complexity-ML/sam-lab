import { describe, expect, it } from 'vitest'
import { ensureHostReviewCheckpoint } from './review-checkpoint'
import { applyProposal, newCard, type AgentProposal } from './pipeline'
import { repairSensitiveOutputPaths } from '../validation/proposal-repair'
import { validatePipeline } from '../validation'
import type { HostRiskDecision } from './risk-gate'

function proposal(): AgentProposal {
  return {
    id: 'risk-change',
    title: 'Risky change',
    summary: 'Change',
    rationale: 'Evidence',
    addedNodes: [],
    updatedNodes: [],
    addedEdges: [],
    removedEdgeIds: [],
    datahubReads: [],
    writeback: '',
  }
}

const highDataRisk: HostRiskDecision = {
  riskType: 'data',
  severity: 'high',
  confidence: 0.9,
  evidence: 'fresh',
  affectedAssets: 24,
  score: 7,
  reasons: ['order_details: 18 sensitive field/tag signal(s).'],
  requiresHumanReview: true,
}

describe('host review checkpoint', () => {
  it('adds a branch-local review and terminal output once', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const next = proposal()
    ensureHostReviewCheckpoint(next, [source], [], { anchorId: source.id, reason: 'High deterministic risk.' })
    ensureHostReviewCheckpoint(next, [source], [], { anchorId: source.id, reason: 'High deterministic risk.' })

    expect(next.requiresHumanReview).toBe(true)
    expect(next.addedNodes.filter((node) => node.data.kind === 'review')).toHaveLength(1)
    expect(next.addedNodes.filter((node) => node.data.kind === 'output')).toHaveLength(1)
    expect(next.addedEdges).toHaveLength(2)
    expect(next.rationale).toContain('Host risk gate:')
  })

  it('routes a sensitive high-risk approval through a versioned protection boundary', () => {
    const sourceBase = newCard('source', 0)
    const source = {
      ...sourceBase,
      id: 'source',
      data: {
        ...sourceBase.data,
        schema: [{ name: 'email', type: 'string' as const, tags: ['PII'] }],
      },
    }
    const next = proposal()

    ensureHostReviewCheckpoint(next, [source], [], {
      anchorId: source.id,
      reason: 'HIGH host risk score 7: order_details: 18 sensitive field/tag signal(s).',
      risk: highDataRisk,
    })
    repairSensitiveOutputPaths(next, [source], [])
    const graph = applyProposal([source], [], next)
    const risk = graph.nodes.find((node) => node.data.kind === 'risk')

    expect(risk).toBeDefined()
    expect(risk?.data.rule).toContain('risk_type=data')
    expect(risk?.data.rule).toContain('severity=high')
    expect(risk?.data.rule).toContain('mitigation=versioned_sensitive_field_protection')
    expect(risk?.data.rule).toContain('residual_risk=verify_post_condition')
    expect(graph.nodes.some((node) => node.data.kind === 'transform' && /mask|tokenize/i.test(node.data.rule ?? ''))).toBe(true)
    expect(validatePipeline(graph.nodes, graph.edges).some((finding) => finding.id.startsWith('sensitive-unprotected-'))).toBe(false)
  })

  it('reuses a reachable review and inserts risk without duplicating the reviewed branch', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile' }
    const review = { ...newCard('review', 2), id: 'review' }
    const output = { ...newCard('output', 3), id: 'output' }
    const edges = [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-review', source: profile.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ]
    const next = proposal()

    ensureHostReviewCheckpoint(next, [source, profile, review, output], edges, {
      anchorId: source.id,
      reason: 'HIGH host risk score 7: order_details: 18 sensitive field/tag signal(s).',
      risk: highDataRisk,
    })
    const graph = applyProposal([source, profile, review, output], edges, next)
    const risk = graph.nodes.find((node) => node.data.kind === 'risk')!

    expect(graph.nodes.filter((node) => node.data.kind === 'review')).toHaveLength(1)
    expect(graph.nodes.filter((node) => node.data.kind === 'output')).toHaveLength(1)
    expect(graph.nodes.filter((node) => node.data.kind === 'risk')).toHaveLength(1)
    expect(graph.edges.some((edge) => edge.source === profile.id && edge.target === risk.id)).toBe(true)
    expect(graph.edges.some((edge) => edge.source === risk.id && edge.target === review.id)).toBe(true)
    expect(graph.edges.some((edge) => edge.source === profile.id && edge.target === review.id)).toBe(false)
  })
})
