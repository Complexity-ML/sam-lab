import { describe, expect, it } from 'vitest'
import { ensureAutonomousSystemCards } from './autonomous-system'
import { parseWorkerPolicy } from './worker-policy'

describe('autonomous system bootstrap', () => {
  it('starts with Controller, a real exploration Worker Node and Catalog Explorer', () => {
    const system = ensureAutonomousSystemCards([])
    const kinds = system.added.map((node) => node.data.kind)
    const worker = system.added.find((node) => node.data.kind === 'worker')

    expect(kinds).toEqual(['control', 'worker', 'explorer'])
    expect(worker?.data.label).toBe('Catalog Audit Worker')
    expect(parseWorkerPolicy(worker?.data.rule)).toMatchObject({
      role: 'exploration',
      batchSize: 8,
      concurrency: 4,
      retry: 'checkpoint',
    })
  })

  it('adds the missing Worker Node to an existing controller/explorer workspace', () => {
    const initial = ensureAutonomousSystemCards([]).added.filter((node) => node.data.kind !== 'worker')
    const resumed = ensureAutonomousSystemCards(initial)

    expect(resumed.added).toHaveLength(1)
    expect(resumed.added[0]?.data.kind).toBe('worker')
  })
})
