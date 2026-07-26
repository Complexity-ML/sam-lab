import { describe, expect, it } from 'vitest'
import { customerActivationEdges as initialEdges, customerActivationNodes as initialNodes } from './pipeline'
import { cardRoleContracts, planPrimaryAgentRoute } from './agent-runner'

describe('agent runner', () => {
  it('follows the approved split branch in graph order', () => {
    expect(planPrimaryAgentRoute(initialNodes, initialEdges).map((node) => node.id)).toEqual([
      'customers-source',
      'schema-analysis',
      'region-split',
      'normalize-customer',
      'agent-decision',
      'consent-validation',
      'activation-output',
    ])
  })

  it('gives every card an explicit execution contract', () => {
    expect(Object.values(cardRoleContracts).every((contract) =>
      contract.input
      && contract.output
      && contract.role
      && contract.mission
      && contract.activation
      && contract.completion)).toBe(true)
  })
})
