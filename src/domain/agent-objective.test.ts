import { describe, expect, it } from 'vitest'
import { dataHubDiscoveryQuery, defaultBlankObjective, resolveAgentObjective } from './agent-objective'

describe('bounded agent objectives', () => {
  it('uses a focused license discovery for blank missions and preserves explicit controller missions', () => {
    expect(dataHubDiscoveryQuery(defaultBlankObjective)).toBe('license')
    expect(dataHubDiscoveryQuery('Execute SAM LAB Control policy: objective=maintain governed graph | on_review=resume | on_idle=monitor')).toBe('license')
    expect(dataHubDiscoveryQuery('Inspect Customer_Analytics_Measures')).toBe('Inspect Customer_Analytics_Measures')
  })

  it('turns empty Play into a software asset management mission', () => {
    expect(resolveAgentObjective('', { hasGraph: false, matchedSource: false })).toMatchObject({
      accepted: true,
      defaulted: true,
      objective: expect.stringContaining('Software Asset Management'),
    })
  })

  it('accepts SAM work and source-label matches while rejecting generic data work', () => {
    expect(resolveAgentObjective('Audit software license renewals', { hasGraph: true, matchedSource: false }).accepted).toBe(true)
    expect(resolveAgentObjective('Trace lineage for the billing table', { hasGraph: true, matchedSource: false }).accepted).toBe(false)
    expect(resolveAgentObjective('Improve this workflow graph', { hasGraph: true, matchedSource: false }).accepted).toBe(true)
    expect(resolveAgentObjective('Customers 360', { hasGraph: true, matchedSource: true }).accepted).toBe(true)
    expect(resolveAgentObjective('tell me a joke about bananas', { hasGraph: true, matchedSource: false }).accepted).toBe(false)
  })
})
