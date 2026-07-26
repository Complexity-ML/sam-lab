import { describe, expect, it } from 'vitest'
import { parseWorkerPolicy, partitionWorkerItems, workerPolicyError, workerPolicyRule } from './worker-policy'

describe('generic Worker Node policy', () => {
  it('round-trips a bounded vendor-neutral policy', () => {
    const rule = workerPolicyRule({ role: 'risk', batchSize: 8, concurrency: 6, retry: 'checkpoint', context: 'branch_only', merge: 'atomic' })
    expect(parseWorkerPolicy(rule)).toEqual({
      role: 'risk',
      batchSize: 8,
      concurrency: 6,
      retry: 'checkpoint',
      maxRetries: 3,
      cooldownSeconds: 30,
      context: 'branch_only',
      merge: 'atomic',
    })
    expect(workerPolicyError(rule)).toBeUndefined()
  })

  it('rejects unsafe or unbounded worker rules', () => {
    expect(workerPolicyError('role=audit | batch_size=64 | max_concurrency=12 | retry=forever | context=shared | merge=direct')).toBe('Worker batch size must be between 1 and 32.')
    expect(workerPolicyError('role=audit | batch_size=4 | max_concurrency=4 | retry=forever | context=branch_only | merge=atomic')).toBe('Worker retry must resume from a checkpoint or remain disabled.')
  })

  it('creates deterministic replayable batches', () => {
    const policy = parseWorkerPolicy('role=incident | batch_size=3 | max_concurrency=2 | retry=checkpoint | context=branch_only | merge=atomic')
    expect(partitionWorkerItems([1, 2, 3, 4, 5, 6, 7], policy)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
  })
})
