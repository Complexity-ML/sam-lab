export type WorkerRole = 'exploration' | 'audit' | 'risk' | 'incident' | 'patch' | 'generic'
export type WorkerRetry = 'checkpoint' | 'none'

export interface WorkerPolicy {
  role: WorkerRole
  batchSize: number
  concurrency: number
  retry: WorkerRetry
  maxRetries?: number
  cooldownSeconds?: number
  context: 'branch_only'
  merge: 'atomic'
}

export const defaultWorkerPolicy: WorkerPolicy = {
  role: 'generic',
  batchSize: 4,
  concurrency: 4,
  retry: 'checkpoint',
  maxRetries: 3,
  cooldownSeconds: 30,
  context: 'branch_only',
  merge: 'atomic',
}

function entries(rule: string | undefined) {
  return new Map((rule ?? '').split('|').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim().toLowerCase()
    return key ? [[key, value] as const] : []
  }))
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function parseWorkerPolicy(rule: string | undefined): WorkerPolicy {
  const values = entries(rule)
  const role = values.get('role')
  return {
    role: ['exploration', 'audit', 'risk', 'incident', 'patch', 'generic'].includes(role ?? '') ? role as WorkerRole : defaultWorkerPolicy.role,
    batchSize: boundedInteger(values.get('batch_size'), defaultWorkerPolicy.batchSize, 1, 32),
    concurrency: boundedInteger(values.get('max_concurrency'), defaultWorkerPolicy.concurrency, 1, 8),
    retry: values.get('retry') === 'none' ? 'none' : 'checkpoint',
    maxRetries: boundedInteger(values.get('max_retries'), defaultWorkerPolicy.maxRetries ?? 3, 1, 10),
    cooldownSeconds: boundedInteger(values.get('cooldown_seconds'), defaultWorkerPolicy.cooldownSeconds ?? 30, 5, 3_600),
    context: 'branch_only',
    merge: 'atomic',
  }
}

export function workerPolicyRule(policy: WorkerPolicy) {
  return `role=${policy.role} | batch_size=${Math.max(1, Math.min(32, Math.round(policy.batchSize)))} | max_concurrency=${Math.max(1, Math.min(8, Math.round(policy.concurrency)))} | retry=${policy.retry} | max_retries=${Math.max(1, Math.min(10, Math.round(policy.maxRetries ?? 3)))} | cooldown_seconds=${Math.max(5, Math.min(3_600, Math.round(policy.cooldownSeconds ?? 30)))} | context=branch_only | merge=atomic`
}

export function workerPolicyError(rule: string | undefined) {
  const values = entries(rule)
  if (!['exploration', 'audit', 'risk', 'incident', 'patch', 'generic'].includes(values.get('role') ?? '')) return 'Choose a supported worker role.'
  const batchSize = Number(values.get('batch_size'))
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32) return 'Worker batch size must be between 1 and 32.'
  const concurrency = Number(values.get('max_concurrency'))
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return 'Worker concurrency must be between 1 and 8.'
  if (!['checkpoint', 'none'].includes(values.get('retry') ?? '')) return 'Worker retry must resume from a checkpoint or remain disabled.'
  if (values.has('max_retries')) {
    const maximumRetries = Number(values.get('max_retries'))
    if (!Number.isInteger(maximumRetries) || maximumRetries < 1 || maximumRetries > 10) return 'Worker retries must be between 1 and 10.'
  }
  if (values.has('cooldown_seconds')) {
    const cooldownSeconds = Number(values.get('cooldown_seconds'))
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 5 || cooldownSeconds > 3_600) return 'Worker cooldown must be between 5 and 3600 seconds.'
  }
  if (values.get('context') !== 'branch_only') return 'Worker context must remain branch-only.'
  if (values.get('merge') !== 'atomic') return 'Worker results must merge atomically.'
  return undefined
}

export function partitionWorkerItems<T>(items: T[], policy: WorkerPolicy) {
  const batches: T[][] = []
  for (let offset = 0; offset < items.length; offset += policy.batchSize) {
    batches.push(items.slice(offset, offset + policy.batchSize))
  }
  return batches
}
