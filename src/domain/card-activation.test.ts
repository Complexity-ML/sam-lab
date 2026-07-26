import { describe, expect, it } from 'vitest'
import { buildCardActivationPlan } from './card-activation'
import { newCard } from './pipeline'

function stateOf(plan: ReturnType<typeof buildCardActivationPlan>, kind: string) {
  return plan.find((item) => item.kind === kind)?.state
}

describe('evidence-driven card activation', () => {
  it('starts a blank player with host-owned control and discovery instead of decorative lineage cards', () => {
    const plan = buildCardActivationPlan([], [])

    expect(stateOf(plan, 'control')).toBe('host-owned')
    expect(stateOf(plan, 'explorer')).toBe('host-owned')
    expect(stateOf(plan, 'risk')).toBe('available')
    expect(stateOf(plan, 'patch')).toBe('available')
  })

  it('recommends analysis, impact and risk when a profile contains fresh material evidence and lineage', () => {
    const source = newCard('source', 0)
    const profile = newCard('profile', 1)
    profile.data.profile = {
      sourceUrn: 'urn:orders',
      capturedAt: '2026-07-25T00:00:00.000Z',
      expiresAt: '2026-07-25T00:05:00.000Z',
      stale: false,
      platform: 'dbt',
      environment: 'PROD',
      quality: 'failing',
      fieldCount: 2,
      profiledFields: [],
      sensitiveFieldCount: 1,
      upstreamCount: 1,
      downstreamCount: 2,
      anomalies: ['Null rate increased'],
      aggregateAudit: {
        kind: 'bounded-aggregate-profile',
        version: 1,
        status: 'complete',
        capturedAt: '2026-07-25T00:00:00.000Z',
        profiledFieldCount: 2,
        riskSignals: [{
          id: 'null-email',
          kind: 'null_spike',
          severity: 'high',
          field: 'email',
          summary: 'Null rate increased',
        }],
        rawRowsRead: false,
        hostVerified: true,
      },
      tokenEstimate: 120,
      storage: { kind: 'bounded-metadata', version: 1, rawRowsStored: false, hostVerified: true },
    }
    const plan = buildCardActivationPlan([source, profile], [])

    expect(stateOf(plan, 'analysis')).toBe('recommended')
    expect(stateOf(plan, 'impact')).toBe('recommended')
    expect(stateOf(plan, 'risk')).toBe('recommended')
    expect(stateOf(plan, 'output')).toBe('recommended')
  })

  it('recommends parallel orchestration and a diagram only for multiple independent incidents', () => {
    const source = newCard('source', 0)
    const plan = buildCardActivationPlan([source], [], [], 3)

    expect(stateOf(plan, 'parallel')).toBe('recommended')
    expect(stateOf(plan, 'diagram')).toBe('recommended')
  })

  it('arms monitoring only after a terminal output exists', () => {
    const output = newCard('output', 0)
    const plan = buildCardActivationPlan([output], [])

    expect(stateOf(plan, 'monitor')).toBe('recommended')
  })
})
