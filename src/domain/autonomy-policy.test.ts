import { describe, expect, it } from 'vitest'
import { autonomyPolicyInstructions, defaultAutonomyPolicy, normalizeAutonomyPolicy, policyForcesProposalReview } from './autonomy-policy'

describe('autonomy policy', () => {
  it('normalizes persisted values without trusting unknown fields', () => {
    expect(normalizeAutonomyPolicy({ humanReview: 'frequent', riskAnalysis: 'exhaustive', uncertainty: 'bounded' })).toEqual({
      humanReview: 'frequent',
      riskAnalysis: 'exhaustive',
      uncertainty: 'bounded',
    })
    expect(normalizeAutonomyPolicy({ humanReview: 'never', riskAnalysis: 'shallow' })).toEqual(defaultAutonomyPolicy)
  })

  it('turns the settings into explicit agent instructions', () => {
    const instructions = autonomyPolicyInstructions({ humanReview: 'critical-only', riskAnalysis: 'exhaustive', uncertainty: 'no-change' })
    expect(instructions.review).toContain('critical/high risk')
    expect(instructions.risk).toContain('every affected dataset')
    expect(instructions.uncertainty).toContain('return no graph mutation')
  })

  it('forces native review only for material changes in frequent mode', () => {
    expect(policyForcesProposalReview({ ...defaultAutonomyPolicy, humanReview: 'frequent' }, 2)).toBe(true)
    expect(policyForcesProposalReview({ ...defaultAutonomyPolicy, humanReview: 'frequent' }, 0)).toBe(false)
    expect(policyForcesProposalReview(defaultAutonomyPolicy, 2)).toBe(false)
  })
})
