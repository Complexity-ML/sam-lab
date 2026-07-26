import type { DataHubAssetSummary, DataHubEvidence } from './datahub'
import type { CatalogDatasetCheckpoint, CatalogExplorationProgress } from './pipeline'
import { isSoftwareAssetCheckpoint, softwareAssetPriority } from './sam-asset'

export interface CatalogInspection {
  asset: DataHubAssetSummary
  evidence: DataHubEvidence[]
}

const dataIncidentIssues = new Set(['quality failing'])
const governanceIssues = new Set(['owner missing', 'tags missing'])
const sensitivePattern = /pii|sensitive|personal|gdpr|secret|credential/i
export const defaultCatalogRetryLimit = 3
export const defaultCatalogRetryCooldownMs = 30_000

export function hasDataIncident(checkpoint: CatalogDatasetCheckpoint) {
  return Boolean(checkpoint.dataRiskSignals?.length)
    || checkpoint.issues.some((issue) => dataIncidentIssues.has(issue))
}

export function hasGovernanceGap(checkpoint: CatalogDatasetCheckpoint) {
  return checkpoint.issues.some((issue) => governanceIssues.has(issue))
}

export function governanceGapIssues(checkpoint: CatalogDatasetCheckpoint) {
  return checkpoint.issues.filter((issue) => governanceIssues.has(issue))
}

export function shouldOpenCatalogConnectivityIncident(progress: CatalogExplorationProgress) {
  return (progress.state === 'failed' || progress.pauseReason === 'connector_unavailable' || progress.pauseReason === 'retry_exhausted') && progress.failed > 0
}

export function resetCatalogRetryState(progress: CatalogExplorationProgress): CatalogExplorationProgress {
  return {
    ...progress,
    state: progress.state === 'complete' ? 'complete' : 'idle',
    pauseReason: undefined,
    connectorRetryCount: 0,
    connectorRecoveryStreak: 0,
    connectorFailureFingerprint: undefined,
    nextRetryAt: undefined,
    checkpointAt: new Date().toISOString(),
    datasets: progress.datasets.map((checkpoint) => checkpoint.dataAuditStatus === 'unavailable' || checkpoint.status === 'unavailable'
      ? { ...checkpoint, attemptCount: 0 }
      : checkpoint),
  }
}

function preferCheckpoint(left: CatalogDatasetCheckpoint, right: CatalogDatasetCheckpoint) {
  return Date.parse(right.capturedAt) >= Date.parse(left.capturedAt) ? right : left
}

export function mergeCatalogProgress(
  left: CatalogExplorationProgress | undefined,
  right: CatalogExplorationProgress | undefined,
): CatalogExplorationProgress | undefined {
  if (!left) return right
  if (!right) return left
  const byUrn = new Map(left.datasets.map((checkpoint) => [checkpoint.urn, checkpoint]))
  right.datasets.forEach((checkpoint) => {
    const previous = byUrn.get(checkpoint.urn)
    byUrn.set(checkpoint.urn, previous ? preferCheckpoint(previous, checkpoint) : checkpoint)
  })
  const datasets = [...byUrn.values()]
  const latest = Date.parse(right.checkpointAt) >= Date.parse(left.checkpointAt) ? right : left
  const total = Math.max(left.total, right.total, datasets.length)
  const retryLimit = latest.connectorRetryLimit ?? defaultCatalogRetryLimit
  const retryableUnavailable = datasets.filter((checkpoint) =>
    (checkpoint.dataAuditStatus === 'unavailable' || checkpoint.status === 'unavailable')
    && (checkpoint.attemptCount ?? 1) < retryLimit).length
  const unaudited = datasets.filter((checkpoint) => !checkpoint.dataAuditStatus).length
  const dataAudited = datasets.filter((checkpoint) => checkpoint.dataAuditStatus === 'complete').length
  const dataAuditCoverageGaps = datasets.filter((checkpoint) => checkpoint.dataAuditStatus === 'coverage_gap').length
  return {
    ...latest,
    total,
    discovered: Math.max(left.discovered, right.discovered, datasets.length),
    inspected: datasets.length,
    dataAudited,
    dataAuditCoverageGaps,
    dataAuditRemaining: Math.max(0, total - datasets.length) + retryableUnavailable + unaudited,
    failed: datasets.filter((checkpoint) => checkpoint.status === 'unavailable').length,
    incidents: datasets.filter(hasDataIncident).length,
    governanceGaps: datasets.filter(hasGovernanceGap).length,
    connectorRetryCount: latest.connectorRetryCount ?? 0,
    connectorRetryLimit: retryLimit,
    remaining: Math.max(0, total - datasets.length) + retryableUnavailable + unaudited,
    datasets,
  }
}

export function isInspectionUnavailable(inspection: CatalogInspection) {
  return inspection.evidence.length === 0
    || inspection.evidence.every((read) => read.status !== 'ok' || read.stale)
}

export async function inspectWithBoundedRetry(
  urn: string,
  inspect: (urn: string, force?: boolean) => Promise<CatalogInspection>,
  options: { retryUnavailable?: boolean } = {},
) {
  const first = await inspect(urn, false)
  if (!isInspectionUnavailable(first) || options.retryUnavailable === false) return first
  return inspect(urn, true)
}

const clampConcurrency = (value: number) => Math.max(1, Math.min(8, Math.floor(value)))

export function resolveAdaptiveCatalogConcurrency(
  previous?: CatalogExplorationProgress,
  initialConcurrency = 4,
) {
  if (!previous) return clampConcurrency(initialConcurrency)
  const current = clampConcurrency(previous.concurrency || initialConcurrency)
  const failed = previous.batchFailed ?? 0
  if (previous.pauseReason === 'connector_unavailable' || failed > 0) return 1
  if (current === 1 && (previous.connectorRecoveryStreak ?? 0) < 2) return 1
  if (current === 1 && (previous.connectorRecoveryStreak ?? 0) >= 2) return Math.min(clampConcurrency(initialConcurrency), 2)
  if (!previous.batchDurationMs) return current
  const processed = previous.batchProcessed ?? 0
  const cached = previous.batchCached ?? 0
  // A cached batch measures local SQLite/cache speed, not connector capacity.
  // Do not use it to increase pressure on the MCP transport.
  if (processed > 0 && cached >= Math.ceil(processed / 2)) return current
  if (previous.batchDurationMs <= 8_000) return Math.min(clampConcurrency(initialConcurrency), current + 1)
  if (previous.batchDurationMs >= 15_000) return Math.max(1, current - 1)
  return current
}
export function shouldCallAgentForCatalog(
  previous: CatalogExplorationProgress | undefined,
  current: CatalogExplorationProgress,
  profileRisk = false,
) {
  if (current.state === 'failed' || current.pauseReason === 'connector_unavailable' || current.pauseReason === 'retry_exhausted') return false
  return profileRisk
    || current.incidents > (previous?.incidents ?? 0)
    || (current.state === 'complete' && previous?.state !== 'complete')
}

export function rankCatalogCandidateUrns(progress: CatalogExplorationProgress) {
  const score = (checkpoint: CatalogDatasetCheckpoint) =>
    softwareAssetPriority(checkpoint) * 1_000_000
    + (checkpoint.status === 'healthy' ? 1_000 : checkpoint.status === 'warning' ? 100 : 0)
    + checkpoint.ownerCount * 10
    + checkpoint.fieldCount
    + checkpoint.upstreamCount
    + checkpoint.downstreamCount

  return progress.datasets
    .filter((checkpoint) => checkpoint.status !== 'unavailable' && isSoftwareAssetCheckpoint(checkpoint))
    .sort((left, right) => score(right) - score(left) || left.urn.localeCompare(right.urn))
    .map((checkpoint) => checkpoint.urn)
}

/**
 * A catalog commonly exposes the same logical dataset through several
 * platforms (dbt, warehouse, BI, object storage). Once one representation is
 * materialized in the graph, its versioned lineage already provides the route
 * to those downstream representations. Treating every URN as a new autonomous
 * objective makes the model propose the same branch repeatedly.
 */
export function catalogDatasetFamilyKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_(replica|view|explore)$/g, '')
    .replace(/^_+|_+$/g, '')
}

export function rankCatalogRiskCandidateUrns(
  progress: CatalogExplorationProgress,
  excludedUrns: string[] = [],
) {
  const excluded = new Set(excludedUrns)
  const excludedFamilies = new Set(progress.datasets
    .filter((checkpoint) => excluded.has(checkpoint.urn))
    .map((checkpoint) => catalogDatasetFamilyKey(checkpoint.name))
    .filter(Boolean))
  const score = (checkpoint: CatalogDatasetCheckpoint) =>
    softwareAssetPriority(checkpoint) * 1_000_000
    + (checkpoint.qualityStatus === 'failing' || hasDataIncident(checkpoint) ? 100_000 : 0)
    + checkpoint.downstreamCount * 10
    + checkpoint.upstreamCount

  return progress.datasets
    .filter((checkpoint) => checkpoint.status !== 'unavailable'
      && !excluded.has(checkpoint.urn)
      && !excludedFamilies.has(catalogDatasetFamilyKey(checkpoint.name))
      && isSoftwareAssetCheckpoint(checkpoint))
    .sort((left, right) => score(right) - score(left) || left.urn.localeCompare(right.urn))
    .map((checkpoint) => checkpoint.urn)
}

export function catalogHasPendingAutonomousWork(
  progress: CatalogExplorationProgress | undefined,
  representedUrns: string[] = [],
) {
  if (!progress) return false
  if (progress.state !== 'complete') return true
  return rankCatalogRiskCandidateUrns(progress, representedUrns).length > 0
}

export function selectCatalogCandidateUrn(
  progress: CatalogExplorationProgress,
  preferredUrns: string[] = [],
) {
  const available = new Set(
    progress.datasets
      .filter((checkpoint) => checkpoint.status !== 'unavailable' && isSoftwareAssetCheckpoint(checkpoint))
      .map((checkpoint) => checkpoint.urn),
  )
  return preferredUrns.find((urn) => available.has(urn))
    ?? rankCatalogCandidateUrns(progress)[0]
}

function fingerprint(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function checkpointForInspection(inspection: CatalogInspection): CatalogDatasetCheckpoint {
  const { asset, evidence } = inspection
  const unavailable = isInspectionUnavailable(inspection)
  const collectionFailures = unavailable
    ? evidence
      .filter((read) => read.status !== 'ok' || read.stale)
      .slice(0, 4)
      .map((read) => `${read.tool}: ${read.summary}`)
    : []
  const issues = [
    ...(unavailable ? ['metadata unavailable'] : []),
    ...collectionFailures,
    ...(asset.freshness.stale ? ['stale evidence'] : []),
    ...(asset.owners.length === 0 ? ['owner missing'] : []),
    ...(asset.tags.length === 0 ? ['tags missing'] : []),
    ...(asset.qualityStatus === 'failing' ? ['quality failing'] : []),
    ...(asset.dataProfile?.status === 'unavailable' ? ['data profile unavailable'] : []),
    ...(asset.dataProfile?.status === 'error' ? ['data profile read failed'] : []),
    ...(asset.dataProfile?.risks.map((risk) => `data-risk:${risk.kind}${risk.field ? `:${risk.field}` : ''}`) ?? []),
  ]
  const status: CatalogDatasetCheckpoint['status'] = unavailable ? 'unavailable' : issues.length ? 'warning' : 'healthy'
  const sensitiveSignalCount = asset.fields.filter((field) => field.tags?.some((tag) => sensitivePattern.test(tag))).length
    + asset.tags.filter((tag) => sensitivePattern.test(tag)).length
  const downstreamMlRefs = asset.downstream
    .filter((item): item is typeof item & { kind: 'feature' | 'model' | 'deployment' } => ['feature', 'model', 'deployment'].includes(item.kind ?? ''))
    .slice(0, 30)
    .map(({ urn, name, kind }) => ({ urn, name, kind }))
  const capturedAt = evidence.map((read) => read.capturedAt).sort().at(-1) ?? asset.freshness.capturedAt
  const expiresAt = evidence.filter((read) => read.status === 'ok' && !read.stale).map((read) => read.expiresAt).sort()[0] ?? capturedAt
  const dataAuditStatus: CatalogDatasetCheckpoint['dataAuditStatus'] = unavailable
    ? 'unavailable'
    : asset.dataProfile?.status === 'available'
      ? 'complete'
      : 'coverage_gap'
  return {
    urn: asset.urn,
    name: asset.name,
    status,
    fieldCount: asset.fields.length,
    sensitiveSignalCount,
    qualityStatus: asset.qualityStatus,
    dataProfileStatus: asset.dataProfile?.status,
    dataAuditStatus,
    dataAuditedAt: capturedAt,
    dataRiskSignals: asset.dataProfile?.risks ?? [],
    ownerCount: asset.owners.length,
    upstreamCount: asset.upstream.length,
    downstreamCount: asset.downstream.length,
    downstreamMlCount: downstreamMlRefs.length,
    downstreamMlRefs,
    issues,
    fingerprint: fingerprint([
      asset.urn,
      asset.fields.map((field) => `${field.name}:${field.type}:${field.tags?.join(',') ?? ''}`).join('|'),
      asset.owners.join('|'),
      asset.tags.join('|'),
      asset.qualityStatus,
      asset.dataProfile?.status ?? 'unavailable',
      asset.dataProfile?.capturedAt ?? '',
      asset.dataProfile?.previousCapturedAt ?? '',
      asset.dataProfile?.risks.map((risk) => `${risk.id}:${risk.severity}:${risk.current ?? ''}:${risk.previous ?? ''}`).join('|') ?? '',
      asset.upstream.map((item) => item.urn).join('|'),
      asset.downstream.map((item) => item.urn).join('|'),
      downstreamMlRefs.map((item) => `${item.kind}:${item.urn}`).join('|'),
      evidence.map((read) => `${read.tool}:${read.status}:${read.stale}:${read.summary}`).join('|'),
    ].join('::')),
    capturedAt,
    expiresAt,
    attemptCount: 1,
    lastAttemptAt: capturedAt,
  }
}

export async function inspectCatalogInParallel(
  assets: DataHubAssetSummary[],
  inspect: (urn: string) => Promise<CatalogInspection>,
  options: {
    batchSize?: number
    cacheMode?: 'prefer' | 'refresh'
    concurrency?: number
    mode?: 'dataset' | 'catalog'
    previous?: CatalogDatasetCheckpoint[]
    previousProgress?: CatalogExplorationProgress
    isCancelled?(): boolean
    maxInspections?: number
    onCheckpoint?(progress: CatalogExplorationProgress, inspections: CatalogInspection[]): void
    query?: string
    retryCooldownMs?: number
    retryLimit?: number
  } = {},
) {
  const requestedConcurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 4)))
  const configuredBatchSize = Math.max(1, Math.min(32, Math.floor(options.batchSize ?? options.maxInspections ?? (assets.length || 1))))
  const inspections: CatalogInspection[] = []
  const previous = new Map((options.previous ?? []).map((checkpoint) => [checkpoint.urn, checkpoint]))
  const checkpoints: CatalogDatasetCheckpoint[] = assets.flatMap((asset) => {
    const checkpoint = previous.get(asset.urn)
    return checkpoint ? [checkpoint] : []
  })
  // New catalog entries must not queue behind one pathological entity forever.
  // Unavailable checkpoints remain retryable, but only after every never-read
  // dataset has received its first bounded inspection.
  const uninspected = assets.filter((asset) => {
    const checkpoint = previous.get(asset.urn)
    return !checkpoint || !checkpoint.dataAuditStatus
  })
  // Dataset read failures are local collection gaps. Give each unavailable
  // dataset its own durable retry budget, after all never-inspected assets have
  // had a turn, instead of opening a connector-wide circuit.
  const datasetRetryLimit = Math.max(1, Math.min(10, Math.floor(options.retryLimit ?? defaultCatalogRetryLimit)))
  const retryable = assets.filter((asset) => {
    const checkpoint = previous.get(asset.urn)
    if (!checkpoint) return false
    return (checkpoint.dataAuditStatus === 'unavailable' || checkpoint.status === 'unavailable')
      && (checkpoint.attemptCount ?? 1) < datasetRetryLimit
  })
  // Evidence expiry must not turn one bounded catalog objective into a hidden
  // refresh loop. Once every dataset has a checkpoint, the first-pass audit is
  // complete. Live Monitor or an explicit refresh/reset starts a later audit.
  const pending = [...uninspected, ...retryable]
  const inspectionBudget = Math.max(1, Math.min(configuredBatchSize, Math.floor(options.maxInspections ?? configuredBatchSize), pending.length || 1))
  const scheduled = pending.slice(0, inspectionBudget)
  const assetOrder = new Map(assets.map((asset, index) => [asset.urn, index]))
  const orderedCheckpoints = () => [...checkpoints].sort((left, right) => (assetOrder.get(left.urn) ?? 0) - (assetOrder.get(right.urn) ?? 0))
  const remainingWork = () => assets.filter((asset) => {
    const checkpoint = checkpoints.find((candidate) => candidate.urn === asset.urn)
    if (!checkpoint) return true
    if (!checkpoint.dataAuditStatus) return true
    return (checkpoint.dataAuditStatus === 'unavailable' || checkpoint.status === 'unavailable')
      && (checkpoint.attemptCount ?? 1) < datasetRetryLimit
  }).length
  let batchDurationMs = 0
  let batchFailed = 0
  let batchProcessed = 0
  let batchCached = 0
  let connectorRecoveryStreak = options.previousProgress?.connectorRecoveryStreak ?? 0
  const connectorRetryLimit = datasetRetryLimit
  // Reaching this function means catalog discovery returned assets. Dataset
  // timeouts must not inherit or extend a connector-wide retry circuit.
  const connectorRetryCount = 0
  const connectorFailureFingerprint = undefined
  const nextRetryAt = undefined
  let effectiveConcurrency = requestedConcurrency

  const upsertCheckpoint = (checkpoint: CatalogDatasetCheckpoint) => {
    const index = checkpoints.findIndex((candidate) => candidate.urn === checkpoint.urn)
    if (index < 0) checkpoints.push(checkpoint)
    else checkpoints[index] = checkpoint
  }

  const emit = (state: CatalogExplorationProgress['state'], pauseReason?: CatalogExplorationProgress['pauseReason']) => {
    const failed = checkpoints.filter((item) => item.status === 'unavailable').length
    // Collection failures and governance gaps are not evidence that the
    // underlying dataset is unhealthy.
    const incidents = checkpoints.filter(hasDataIncident).length
    const governanceGaps = checkpoints.filter(hasGovernanceGap).length
    const dataAudited = checkpoints.filter((item) => item.dataAuditStatus === 'complete').length
    const dataAuditCoverageGaps = checkpoints.filter((item) => item.dataAuditStatus === 'coverage_gap').length
    const dataAuditRemaining = remainingWork()
    options.onCheckpoint?.({
      query: options.query ?? '*',
      total: assets.length,
      discovered: assets.length,
      inspected: checkpoints.length,
      dataAudited,
      dataAuditCoverageGaps,
      dataAuditRemaining,
      failed,
      incidents,
      governanceGaps,
      concurrency: effectiveConcurrency,
      batchSize: configuredBatchSize,
      batchDurationMs,
      batchFailed,
      batchProcessed,
      batchCached,
      connectorRecoveryStreak,
      connectorRetryCount,
      connectorRetryLimit,
      connectorFailureFingerprint,
      nextRetryAt,
      remaining: dataAuditRemaining,
      mode: options.mode ?? 'catalog',
      cacheMode: options.cacheMode ?? 'prefer',
      phase: state === 'complete' || state === 'paused' || state === 'failed' ? 'checkpoint' : 'inspect',
      state,
      pauseReason,
      checkpointAt: new Date().toISOString(),
      datasets: orderedCheckpoints(),
    }, [...inspections])
  }

  emit('inspecting')
  const runStartedAt = Date.now()
  const inspectBatch = async (batch: DataHubAssetSummary[]) => {
    const results = await Promise.all(batch.map(async (asset) => {
      try {
        const inspection = await inspect(asset.urn)
        inspections.push(inspection)
        const checkpoint = checkpointForInspection(inspection)
        const prior = previous.get(asset.urn)
        checkpoint.attemptCount = (prior?.attemptCount ?? 0) + 1
        checkpoint.lastAttemptAt = checkpoint.capturedAt
        return { checkpoint, inspection }
      } catch (error) {
        const capturedAt = new Date().toISOString()
        return { checkpoint: {
          urn: asset.urn,
          name: asset.name,
          status: 'unavailable' as const,
          dataAuditStatus: 'unavailable' as const,
          dataAuditedAt: capturedAt,
          fieldCount: asset.fields.length,
          ownerCount: asset.owners.length,
          upstreamCount: asset.upstream.length,
          downstreamCount: asset.downstream.length,
          issues: [`inspection failed: ${error instanceof Error ? error.message : String(error)}`],
          fingerprint: fingerprint(`${asset.urn}:inspection-failed`),
          capturedAt,
          expiresAt: capturedAt,
          attemptCount: (previous.get(asset.urn)?.attemptCount ?? 0) + 1,
          lastAttemptAt: capturedAt,
        } }
      }
    }))
    const batchCheckpoints = results.map((result) => result.checkpoint)
    batchDurationMs = Math.max(0, Date.now() - runStartedAt)
    batchFailed += batchCheckpoints.filter((checkpoint) => checkpoint.status === 'unavailable').length
    batchProcessed += results.length
    batchCached += results.filter((result) => result.inspection?.evidence.length && result.inspection.evidence.every((read) => read.cached)).length
    batchCheckpoints.forEach(upsertCheckpoint)
    emit('inspecting')
    return batchCheckpoints
  }

  for (let offset = 0; offset < scheduled.length && !options.isCancelled?.(); offset += requestedConcurrency) {
    await inspectBatch(scheduled.slice(offset, offset + requestedConcurrency))
  }
  connectorRecoveryStreak = batchProcessed > 0 && batchFailed === 0
    ? Math.min(100, (options.previousProgress?.connectorRecoveryStreak ?? 0) + 1)
    : 0
  const hasMore = scheduled.length < pending.length || remainingWork() > 0
  const cancelled = options.isCancelled?.() === true
  const state: CatalogExplorationProgress['state'] = cancelled
    ? 'paused'
    : hasMore
      ? 'inspecting'
      : 'complete'
  const pauseReason: CatalogExplorationProgress['pauseReason'] = cancelled
    ? 'cancelled'
    : undefined
  emit(state, pauseReason)
  return { inspections, progress: {
    query: options.query ?? '*',
    total: assets.length,
    discovered: assets.length,
    inspected: checkpoints.length,
    dataAudited: checkpoints.filter((item) => item.dataAuditStatus === 'complete').length,
    dataAuditCoverageGaps: checkpoints.filter((item) => item.dataAuditStatus === 'coverage_gap').length,
    dataAuditRemaining: remainingWork(),
    failed: checkpoints.filter((item) => item.status === 'unavailable').length,
    incidents: checkpoints.filter(hasDataIncident).length,
    governanceGaps: checkpoints.filter(hasGovernanceGap).length,
    concurrency: effectiveConcurrency,
    batchSize: configuredBatchSize,
    batchDurationMs,
    batchFailed,
    batchProcessed,
    batchCached,
    connectorRecoveryStreak,
    connectorRetryCount,
    connectorRetryLimit,
    connectorFailureFingerprint,
    nextRetryAt,
    remaining: remainingWork(),
    mode: options.mode ?? 'catalog',
    cacheMode: options.cacheMode ?? 'prefer',
    phase: 'checkpoint',
    state,
    pauseReason,
    checkpointAt: new Date().toISOString(),
    datasets: orderedCheckpoints(),
  } satisfies CatalogExplorationProgress }
}
