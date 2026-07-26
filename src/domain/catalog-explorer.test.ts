import { describe, expect, it, vi } from 'vitest'
import { catalogDatasetFamilyKey, catalogHasPendingAutonomousWork, checkpointForInspection, governanceGapIssues, inspectCatalogInParallel, inspectWithBoundedRetry, mergeCatalogProgress, rankCatalogCandidateUrns, rankCatalogRiskCandidateUrns, resetCatalogRetryState, resolveAdaptiveCatalogConcurrency, selectCatalogCandidateUrn, shouldCallAgentForCatalog, shouldOpenCatalogConnectivityIncident, type CatalogInspection } from './catalog-explorer'
import type { DataHubAssetSummary } from './datahub'

const capturedAt = '2026-07-24T08:00:00.000Z'
const freshExpiry = '2099-07-24T08:05:00.000Z'

function asset(index: number): DataHubAssetSummary {
  return {
    urn: `urn:li:dataset:test-${index}`,
    name: `dataset-${index}`,
    platform: 'test',
    environment: 'PROD',
    description: '',
    owners: ['Data Team'],
    tags: ['governed'],
    fields: [{ name: 'id', type: 'string' }],
    qualityStatus: 'healthy',
    upstream: [],
    downstream: [],
    freshness: { capturedAt, expiresAt: freshExpiry, stale: false },
  }
}

function inspection(value: DataHubAssetSummary): CatalogInspection {
  return {
    asset: value,
    evidence: [{
      tool: 'get_entities',
      urn: value.urn,
      capturedAt,
      expiresAt: freshExpiry,
      status: 'ok',
      summary: 'fresh',
      cached: false,
      stale: false,
    }],
  }
}

describe('Catalog Explorer', () => {
  it('ranks reusable candidates from the complete checkpoint instead of only the latest batch', () => {
    const healthy = checkpointForInspection(inspection({ ...asset(1), name: 'license_utilization' }))
    const governedWarning = checkpointForInspection(inspection({ ...asset(2), name: 'software_contracts', owners: [], fields: [{ name: 'id', type: 'string' }, { name: 'product', type: 'string' }] }))
    const unavailable = checkpointForInspection({
      asset: asset(3),
      evidence: [{ ...inspection(asset(3)).evidence[0]!, status: 'error', stale: true, summary: 'timed out' }],
    })

    expect(rankCatalogCandidateUrns({
      query: '*',
      total: 3,
      discovered: 3,
      inspected: 3,
      failed: 1,
      incidents: 0,
      governanceGaps: 1,
      concurrency: 1,
      datasets: [unavailable, governedWarning, healthy],
      checkpointAt: capturedAt,
      state: 'complete',
    })).toEqual([healthy.urn, governedWarning.urn])
  })

  it('resumes a completed checkpoint from the source in the rejected version before using catalog rank', () => {
    const rankedFirst = checkpointForInspection(inspection({ ...asset(1), name: 'license_utilization' }))
    const rejectedSource = checkpointForInspection(inspection({ ...asset(2), name: 'software_contracts', owners: [] }))
    const unavailable = checkpointForInspection({
      asset: asset(3),
      evidence: [{ ...inspection(asset(3)).evidence[0]!, status: 'error', stale: true, summary: 'timed out' }],
    })
    const progress = {
      query: '*',
      total: 3,
      discovered: 3,
      inspected: 3,
      failed: 1,
      incidents: 0,
      governanceGaps: 1,
      concurrency: 4,
      datasets: [rankedFirst, rejectedSource, unavailable],
      checkpointAt: capturedAt,
      state: 'complete' as const,
    }

    expect(selectCatalogCandidateUrn(progress, [rejectedSource.urn])).toBe(rejectedSource.urn)
    expect(selectCatalogCandidateUrn(progress, [unavailable.urn])).toBe(rankedFirst.urn)
  })

  it('audits the complete catalog with bounded concurrency', async () => {
    const assets = Array.from({ length: 17 }, (_, index) => asset(index))
    let active = 0
    let maximumActive = 0
    const inspect = vi.fn(async (urn: string) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return inspection(assets.find((candidate) => candidate.urn === urn)!)
    })

    const result = await inspectCatalogInParallel(assets, inspect, { concurrency: 4 })

    expect(inspect).toHaveBeenCalledTimes(17)
    expect(maximumActive).toBeLessThanOrEqual(4)
    expect(result.progress).toMatchObject({ total: 17, discovered: 17, inspected: 17, state: 'complete' })
    expect(result.progress.datasets.map((dataset) => dataset.urn)).toEqual(assets.map((candidate) => candidate.urn))
  })

  it('does not restart a completed audit just because its earliest evidence expired', async () => {
    const assets = Array.from({ length: 4 }, (_, index) => asset(index))
    const expired = assets.map((value) => ({
      ...checkpointForInspection(inspection(value)),
      expiresAt: '2026-07-24T08:00:01.000Z',
    }))
    const inspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))

    const result = await inspectCatalogInParallel(assets, inspect, {
      cacheMode: 'prefer',
      previous: expired,
      previousProgress: {
        query: '*',
        total: 4,
        discovered: 4,
        inspected: 4,
        failed: 0,
        incidents: 0,
        governanceGaps: 0,
        concurrency: 4,
        remaining: 0,
        mode: 'catalog',
        cacheMode: 'prefer',
        state: 'complete',
        checkpointAt: capturedAt,
        datasets: expired,
      },
    })

    expect(inspect).not.toHaveBeenCalled()
    expect(result.progress).toMatchObject({ inspected: 4, remaining: 0, state: 'complete' })
  })

  it('isolates a failed dataset instead of aborting the remaining audit', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset(index))
    const result = await inspectCatalogInParallel(assets, async (urn) => {
      if (urn.endsWith('2')) throw new Error('connector timed out')
      return inspection(assets.find((candidate) => candidate.urn === urn)!)
    }, { concurrency: 3 })

    expect(result.progress).toMatchObject({ inspected: 5, failed: 1, incidents: 0, remaining: 1, state: 'inspecting' })
    expect(result.progress.datasets.find((dataset) => dataset.urn.endsWith('2'))).toMatchObject({
      status: 'unavailable',
      issues: ['inspection failed: connector timed out'],
    })
  })

  it('separates governance gaps from data incidents', async () => {
    const governanceAsset = { ...asset(1), owners: [], tags: [] }
    const failingAsset = { ...asset(2), qualityStatus: 'failing' as const }

    const result = await inspectCatalogInParallel(
      [governanceAsset, failingAsset],
      async (urn) => inspection(urn === governanceAsset.urn ? governanceAsset : failingAsset),
      { concurrency: 2 },
    )

    expect(result.progress).toMatchObject({
      incidents: 1,
      governanceGaps: 1,
      failed: 0,
      state: 'complete',
    })
    expect(governanceGapIssues(result.progress.datasets.find((dataset) => dataset.urn === governanceAsset.urn)!)).toEqual([
      'owner missing',
      'tags missing',
    ])
  })

  it('persists bounded quality and sensitive risk signals in the catalog checkpoint', () => {
    const checkpoint = checkpointForInspection(inspection({
      ...asset(3),
      tags: ['governed', 'PII'],
      fields: [
        { name: 'id', type: 'string' },
        { name: 'email', type: 'string', tags: ['Sensitive'] },
      ],
      qualityStatus: 'failing',
    }))

    expect(checkpoint).toMatchObject({
      qualityStatus: 'failing',
      sensitiveSignalCount: 2,
      issues: expect.arrayContaining(['quality failing']),
    })
  })

  it('persists aggregate data anomalies as evidence-backed incidents', async () => {
    const drifted = {
      ...asset(4),
      dataProfile: {
        status: 'available' as const,
        capturedAt,
        previousCapturedAt: '2026-07-24T07:00:00.000Z',
        rowCount: 40,
        previousRowCount: 100,
        fields: [],
        risks: [{
          id: 'volume_drop:dataset',
          kind: 'volume_drop' as const,
          severity: 'high' as const,
          summary: 'Row volume fell 60% between the two latest profiles.',
          current: 40,
          previous: 100,
        }],
      },
    }

    const result = await inspectCatalogInParallel([drifted], async () => inspection(drifted), { concurrency: 1 })

    expect(result.progress).toMatchObject({ incidents: 1, failed: 0, state: 'complete' })
    expect(result.progress.datasets[0]).toMatchObject({
      dataProfileStatus: 'available',
      dataRiskSignals: [expect.objectContaining({ kind: 'volume_drop', severity: 'high' })],
      issues: expect.arrayContaining(['data-risk:volume_drop']),
    })
  })

  it('selects software asset evidence instead of unrelated PII or generic quality datasets', () => {
    const governance = checkpointForInspection(inspection({ ...asset(1), tags: [] }))
    const sensitive = checkpointForInspection(inspection({
      ...asset(2),
      fields: [{ name: 'email', type: 'string', tags: ['PII'] }],
      downstream: [{ urn: 'urn:li:dataset:consumer', name: 'consumer', sensitive: false }],
    }))
    const failing = checkpointForInspection(inspection({ ...asset(3), qualityStatus: 'failing' }))
    const licenses = checkpointForInspection(inspection({ ...asset(4), name: 'license_utilization' }))
    const progress = {
      query: '*',
      total: 4,
      discovered: 4,
      inspected: 4,
      failed: 0,
      incidents: 1,
      governanceGaps: 1,
      concurrency: 4,
      state: 'complete' as const,
      checkpointAt: capturedAt,
      datasets: [governance, sensitive, failing, licenses],
    }

    expect(rankCatalogRiskCandidateUrns(progress)).toEqual([licenses.urn])
    expect(rankCatalogRiskCandidateUrns(progress, [licenses.urn])).toEqual([])
  })

  it('does not rebuild the same logical software asset branch for every platform representation', () => {
    const softwareCheckpoint = (urn: string, name: string, count: number) => checkpointForInspection(inspection({
      ...asset(count),
      urn,
      name,
    }))
    const dbt = softwareCheckpoint('urn:dbt:license-utilization', 'license_utilization', 8)
    const warehouse = softwareCheckpoint('urn:snowflake:license-utilization', 'LICENSE_UTILIZATION', 7)
    const replica = softwareCheckpoint('urn:snowflake:license-utilization-replica', 'license_utilization_replica', 5)
    const contracts = softwareCheckpoint('urn:dbt:software-contracts', 'software_contracts', 4)
    const progress = {
      query: '*',
      total: 4,
      discovered: 4,
      inspected: 4,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 4,
      state: 'complete' as const,
      checkpointAt: capturedAt,
      datasets: [dbt, warehouse, replica, contracts],
    }

    expect(catalogDatasetFamilyKey('License Utilization')).toBe('license_utilization')
    expect(catalogDatasetFamilyKey('license_utilization_replica')).toBe('license_utilization')
    expect(rankCatalogRiskCandidateUrns(progress, [dbt.urn])).toEqual([contracts.urn])
  })

  it('keeps autonomous work alive until catalog coverage and risk branches are represented', () => {
    const licenseUsage = checkpointForInspection(inspection({
      ...asset(2),
      name: 'license_usage',
    }))
    const complete = {
      query: '*',
      total: 1,
      discovered: 1,
      inspected: 1,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 1,
      state: 'complete' as const,
      checkpointAt: capturedAt,
      datasets: [licenseUsage],
    }

    expect(catalogHasPendingAutonomousWork({ ...complete, state: 'inspecting' })).toBe(true)
    expect(catalogHasPendingAutonomousWork(complete)).toBe(true)
    expect(catalogHasPendingAutonomousWork(complete, [licenseUsage.urn])).toBe(false)
  })

  it('keeps catalog coverage moving when a complete dataset batch is unavailable', async () => {
    const assets = Array.from({ length: 12 }, (_, index) => asset(index))
    const inspect = vi.fn(async () => { throw new Error('MCP unavailable') })

    const result = await inspectCatalogInParallel(assets, inspect, { concurrency: 4 })

    expect(inspect).toHaveBeenCalledTimes(12)
    expect(result.progress).toMatchObject({
      total: 12,
      inspected: 12,
      failed: 12,
      remaining: 12,
      concurrency: 4,
      connectorRetryCount: 0,
      connectorRecoveryStreak: 0,
      incidents: 0,
      state: 'inspecting',
    })
    expect(result.progress.pauseReason).toBeUndefined()
  })

  it('retries one unavailable inspection with a forced fresh read', async () => {
    const value = asset(1)
    const unavailable = {
      asset: value,
      evidence: [{
        ...inspection(value).evidence[0]!,
        status: 'error' as const,
        stale: true,
      }],
    }
    const inspect = vi.fn(async (_urn: string, force = false) => force ? inspection(value) : unavailable)

    const result = await inspectWithBoundedRetry(value.urn, inspect)

    expect(result).toEqual(inspection(value))
    expect(inspect).toHaveBeenNthCalledWith(1, value.urn, false)
    expect(inspect).toHaveBeenNthCalledWith(2, value.urn, true)
  })

  it('never retries a healthy inspection or exceeds one unavailable retry', async () => {
    const value = asset(1)
    const healthyInspect = vi.fn(async () => inspection(value))
    await inspectWithBoundedRetry(value.urn, healthyInspect)
    expect(healthyInspect).toHaveBeenCalledTimes(1)

    const unavailable = {
      asset: value,
      evidence: [{
        ...inspection(value).evidence[0]!,
        status: 'error' as const,
        stale: true,
      }],
    }
    const unavailableInspect = vi.fn(async () => unavailable)
    expect(await inspectWithBoundedRetry(value.urn, unavailableInspect)).toEqual(unavailable)
    expect(unavailableInspect).toHaveBeenCalledTimes(2)
  })

  it('defers unavailable catalog retries to the next versioned checkpoint', async () => {
    const value = asset(1)
    const unavailable = {
      asset: value,
      evidence: [{
        ...inspection(value).evidence[0]!,
        status: 'error' as const,
        stale: true,
      }],
    }
    const inspect = vi.fn(async () => unavailable)

    expect(await inspectWithBoundedRetry(value.urn, inspect, { retryUnavailable: false })).toEqual(unavailable)
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('adapts workers between one and eight from batch latency and failures', () => {
    const base = {
      query: '*',
      total: 67,
      discovered: 67,
      inspected: 4,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 4,
      batchSize: 4,
      batchDurationMs: 4_000,
      batchFailed: 0,
      batchProcessed: 4,
      batchCached: 0,
      state: 'inspecting' as const,
      checkpointAt: capturedAt,
      datasets: [],
    }

    expect(resolveAdaptiveCatalogConcurrency()).toBe(4)
    expect(resolveAdaptiveCatalogConcurrency(base)).toBe(4)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, concurrency: 7 }, 8)).toBe(8)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, batchDurationMs: 20_000 })).toBe(3)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, batchFailed: 1 })).toBe(1)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, batchCached: 4 })).toBe(4)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, batchCached: 2 })).toBe(4)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, concurrency: 1, state: 'paused', pauseReason: 'connector_unavailable' })).toBe(1)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, concurrency: 1, connectorRecoveryStreak: 1 })).toBe(1)
    expect(resolveAdaptiveCatalogConcurrency({ ...base, concurrency: 1, connectorRecoveryStreak: 2 })).toBe(2)
  })

  it('records whether the latest adaptive batch was served from cache', async () => {
    const assets = Array.from({ length: 3 }, (_, index) => asset(index))
    const inspect = async (urn: string) => {
      const value = inspection(assets.find((candidate) => candidate.urn === urn)!)
      return { ...value, evidence: value.evidence.map((read) => ({ ...read, cached: true })) }
    }

    const result = await inspectCatalogInParallel(assets, inspect, { concurrency: 4 })

    expect(result.progress).toMatchObject({ batchProcessed: 3, batchCached: 3, batchFailed: 0 })
  })

  it('continues after a later unavailable batch instead of opening a global circuit', async () => {
    const assets = Array.from({ length: 12 }, (_, index) => asset(index))
    let calls = 0
    const inspect = vi.fn(async (urn: string) => {
      calls += 1
      if (calls > 4) throw new Error('MCP unavailable')
      return inspection(assets.find((candidate) => candidate.urn === urn)!)
    })

    const result = await inspectCatalogInParallel(assets, inspect, { concurrency: 4 })

    expect(inspect).toHaveBeenCalledTimes(12)
    expect(result.progress).toMatchObject({
      total: 12,
      inspected: 12,
      failed: 8,
      remaining: 8,
      concurrency: 4,
      connectorRetryCount: 0,
      incidents: 0,
      state: 'inspecting',
    })
    expect(result.progress.pauseReason).toBeUndefined()
  })

  it('keeps one worker until two fresh recovery batches succeed', async () => {
    const assets = Array.from({ length: 6 }, (_, index) => asset(index))
    const paused = {
      query: '*',
      total: 6,
      discovered: 6,
      inspected: 1,
      failed: 1,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 1,
      batchSize: 2,
      batchFailed: 1,
      batchProcessed: 1,
      batchCached: 0,
      connectorRecoveryStreak: 0,
      state: 'paused' as const,
      pauseReason: 'connector_unavailable' as const,
      checkpointAt: capturedAt,
      datasets: [],
    }
    const firstConcurrency = resolveAdaptiveCatalogConcurrency(paused, 4)
    const first = await inspectCatalogInParallel(
      assets,
      async (urn) => inspection(assets.find((candidate) => candidate.urn === urn)!),
      { concurrency: firstConcurrency, maxInspections: 2, previousProgress: paused },
    )
    expect(first.progress).toMatchObject({ concurrency: 1, connectorRecoveryStreak: 1, batchFailed: 0 })

    const secondConcurrency = resolveAdaptiveCatalogConcurrency(first.progress, 4)
    const second = await inspectCatalogInParallel(
      assets,
      async (urn) => inspection(assets.find((candidate) => candidate.urn === urn)!),
      { concurrency: secondConcurrency, maxInspections: 2, previous: first.progress.datasets, previousProgress: first.progress },
    )
    expect(second.progress).toMatchObject({ concurrency: 1, connectorRecoveryStreak: 2, batchFailed: 0 })
    expect(resolveAdaptiveCatalogConcurrency(second.progress, 4)).toBe(2)
  })

  it('resumes from fresh versioned checkpoints and retries unavailable reads', async () => {
    const assets = Array.from({ length: 3 }, (_, index) => asset(index))
    const fresh = checkpointForInspection(inspection(assets[0]!))
    const unavailable = { ...checkpointForInspection(inspection(assets[1]!)), status: 'unavailable' as const }
    const inspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))

    const result = await inspectCatalogInParallel(assets, inspect, { previous: [fresh, unavailable] })

    expect(inspect).toHaveBeenCalledTimes(2)
    expect(inspect).not.toHaveBeenCalledWith(assets[0]!.urn)
    expect(result.progress).toMatchObject({ inspected: 3, failed: 0, state: 'complete' })
  })

  it('inspects never-read datasets before retrying an unavailable checkpoint', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset(index))
    const unavailable = {
      ...checkpointForInspection(inspection(assets[0]!)),
      status: 'unavailable' as const,
      expiresAt: capturedAt,
    }
    const inspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))

    await inspectCatalogInParallel(assets, inspect, {
      maxInspections: 2,
      previous: [unavailable],
    })

    expect(inspect).toHaveBeenNthCalledWith(1, assets[1]!.urn)
    expect(inspect).toHaveBeenNthCalledWith(2, assets[2]!.urn)
    expect(inspect).not.toHaveBeenCalledWith(assets[0]!.urn)
  })

  it('resets connector retry exhaustion for a new player session without losing coverage', () => {
    const unavailable = {
      ...checkpointForInspection(inspection(asset(0))),
      status: 'unavailable' as const,
      attemptCount: 3,
    }
    const progress = {
      query: '*',
      total: 67,
      discovered: 67,
      inspected: 11,
      failed: 2,
      incidents: 0,
      governanceGaps: 3,
      concurrency: 1,
      connectorRetryCount: 3,
      connectorRetryLimit: 3,
      connectorFailureFingerprint: 'failure',
      connectorRecoveryStreak: 0,
      nextRetryAt: freshExpiry,
      state: 'paused' as const,
      pauseReason: 'retry_exhausted' as const,
      checkpointAt: capturedAt,
      datasets: [unavailable],
    }

    expect(resetCatalogRetryState(progress)).toMatchObject({
      inspected: 11,
      failed: 2,
      connectorRetryCount: 0,
      connectorRecoveryStreak: 0,
      state: 'idle',
    })
    expect(resetCatalogRetryState(progress).datasets[0]).toMatchObject({ urn: unavailable.urn, status: 'unavailable', attemptCount: 0 })
    expect(resetCatalogRetryState(progress).pauseReason).toBeUndefined()
    expect(resetCatalogRetryState(progress).connectorFailureFingerprint).toBeUndefined()
  })

  it('never regresses inspected coverage when a checkpoint retry fails again', async () => {
    const assets = Array.from({ length: 12 }, (_, index) => asset(index))
    const previousDatasets = assets.slice(0, 8).map((value, index) => ({
      ...checkpointForInspection(inspection(value)),
      status: index >= 4 ? 'unavailable' as const : 'healthy' as const,
      expiresAt: index >= 4 ? capturedAt : freshExpiry,
    }))
    const previousProgress = {
      query: '*',
      total: 12,
      discovered: 12,
      inspected: 8,
      failed: 4,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 1,
      connectorRetryCount: 1,
      connectorRetryLimit: 3,
      state: 'paused' as const,
      pauseReason: 'connector_unavailable' as const,
      checkpointAt: capturedAt,
      datasets: previousDatasets,
    }

    const result = await inspectCatalogInParallel(assets, async () => {
      throw new Error('still unavailable')
    }, { maxInspections: 4, previous: previousDatasets, previousProgress })

    expect(result.progress).toMatchObject({
      inspected: 12,
      failed: 8,
      connectorRetryCount: 0,
      state: 'inspecting',
    })
    expect(new Set(result.progress.datasets.map((checkpoint) => checkpoint.urn)).size).toBe(12)
  })

  it('does not let legacy connector retry exhaustion block never-inspected datasets', async () => {
    const assets = Array.from({ length: 4 }, (_, index) => asset(index))
    const unavailable = {
      ...checkpointForInspection(inspection(assets[0]!)),
      status: 'unavailable' as const,
      expiresAt: capturedAt,
    }
    const inspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))
    const result = await inspectCatalogInParallel(assets, inspect, {
      previous: [unavailable],
      previousProgress: {
        query: '*',
        total: 4,
        discovered: 4,
        inspected: 1,
        failed: 1,
        incidents: 0,
        governanceGaps: 0,
        concurrency: 1,
        connectorRetryCount: 3,
        connectorRetryLimit: 3,
        state: 'paused',
        pauseReason: 'connector_unavailable',
        checkpointAt: capturedAt,
        datasets: [unavailable],
      },
    })

    expect(inspect).toHaveBeenCalledTimes(4)
    expect(inspect).toHaveBeenNthCalledWith(1, assets[1]!.urn)
    expect(inspect).toHaveBeenNthCalledWith(2, assets[2]!.urn)
    expect(inspect).toHaveBeenNthCalledWith(3, assets[3]!.urn)
    expect(inspect).toHaveBeenNthCalledWith(4, assets[0]!.urn)
    expect(result.progress).toMatchObject({
      inspected: 4,
      connectorRetryCount: 0,
      remaining: 0,
      state: 'complete',
    })
    expect(result.progress.pauseReason).toBeUndefined()
  })

  it('finishes with unavailable evidence after each dataset exhausts its own retry budget', async () => {
    const value = asset(0)
    const unavailable = {
      ...checkpointForInspection(inspection(value)),
      status: 'unavailable' as const,
      attemptCount: 3,
      expiresAt: capturedAt,
    }
    const inspect = vi.fn(async () => inspection(value))

    const result = await inspectCatalogInParallel([value], inspect, {
      previous: [unavailable],
      retryLimit: 3,
    })

    expect(inspect).not.toHaveBeenCalled()
    expect(result.progress).toMatchObject({
      inspected: 1,
      failed: 1,
      remaining: 0,
      state: 'complete',
    })
  })

  it('merges SQLite and card checkpoints by dataset without losing coverage', () => {
    const leftDataset = checkpointForInspection(inspection(asset(0)))
    const rightDataset = checkpointForInspection(inspection(asset(1)))
    const base = {
      query: '*',
      total: 3,
      discovered: 3,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 4,
      state: 'inspecting' as const,
      checkpointAt: capturedAt,
    }
    const merged = mergeCatalogProgress(
      { ...base, inspected: 1, datasets: [leftDataset] },
      { ...base, inspected: 1, checkpointAt: '2026-07-24T08:01:00.000Z', datasets: [rightDataset] },
    )

    expect(merged).toMatchObject({ total: 3, inspected: 2, remaining: 1 })
    expect(merged?.datasets.map((checkpoint) => checkpoint.urn)).toEqual([leftDataset.urn, rightDataset.urn])
  })

  it('checkpoints four assets per autonomous iteration and resumes the remainder', async () => {
    const assets = Array.from({ length: 10 }, (_, index) => asset(index))
    const firstInspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))

    const first = await inspectCatalogInParallel(assets, firstInspect, { concurrency: 4, maxInspections: 4 })

    expect(firstInspect).toHaveBeenCalledTimes(4)
    expect(first.progress).toMatchObject({ inspected: 4, total: 10, state: 'inspecting' })

    const secondInspect = vi.fn(async (urn: string) => inspection(assets.find((candidate) => candidate.urn === urn)!))
    const second = await inspectCatalogInParallel(assets, secondInspect, {
      concurrency: 4,
      maxInspections: 4,
      previous: first.progress.datasets,
    })

    expect(secondInspect).toHaveBeenCalledTimes(4)
    expect(second.progress).toMatchObject({ inspected: 8, total: 10, state: 'inspecting' })
  })

  it('calls the model only for useful catalog checkpoints', () => {
    const base = {
      query: '*',
      total: 12,
      discovered: 12,
      inspected: 4,
      failed: 0,
      incidents: 0,
      governanceGaps: 4,
      concurrency: 4,
      state: 'inspecting' as const,
      checkpointAt: capturedAt,
      datasets: [],
    }

    expect(shouldCallAgentForCatalog(undefined, base)).toBe(false)
    expect(shouldCallAgentForCatalog(base, { ...base, inspected: 8, governanceGaps: 8 })).toBe(false)
    expect(shouldCallAgentForCatalog(base, { ...base, inspected: 8, failed: 4 })).toBe(false)
    expect(shouldCallAgentForCatalog(base, { ...base, inspected: 8, incidents: 1 })).toBe(true)
    expect(shouldCallAgentForCatalog(base, { ...base, inspected: 8 }, true)).toBe(true)
    expect(shouldCallAgentForCatalog(base, { ...base, inspected: 12, state: 'complete' })).toBe(true)
    expect(shouldCallAgentForCatalog(
      { ...base, inspected: 12, state: 'complete' },
      { ...base, inspected: 12, state: 'complete' },
    )).toBe(false)
    expect(shouldCallAgentForCatalog(
      { ...base, inspected: 8 },
      { ...base, inspected: 12, failed: 4, state: 'inspecting' },
    )).toBe(false)
    expect(shouldCallAgentForCatalog(
      { ...base, inspected: 12, failed: 4 },
      { ...base, inspected: 12, failed: 3, state: 'inspecting' },
    )).toBe(false)
    expect(shouldCallAgentForCatalog(base, { ...base, state: 'failed', failed: 4 })).toBe(false)
    expect(shouldCallAgentForCatalog(base, { ...base, state: 'paused', pauseReason: 'connector_unavailable', failed: 4 })).toBe(false)
  })

  it('opens a connector incident only after the catalog circuit actually fails', () => {
    const base = {
      query: '*',
      total: 67,
      discovered: 67,
      inspected: 4,
      failed: 2,
      incidents: 0,
      governanceGaps: 2,
      concurrency: 4,
      state: 'inspecting' as const,
      checkpointAt: capturedAt,
      datasets: [],
    }

    expect(shouldOpenCatalogConnectivityIncident(base)).toBe(false)
    expect(shouldOpenCatalogConnectivityIncident({ ...base, state: 'failed' })).toBe(true)
    expect(shouldOpenCatalogConnectivityIncident({ ...base, state: 'paused', pauseReason: 'connector_unavailable' })).toBe(true)
    expect(shouldOpenCatalogConnectivityIncident({ ...base, state: 'paused', pauseReason: 'retry_exhausted' })).toBe(true)
    expect(shouldOpenCatalogConnectivityIncident({ ...base, state: 'paused', pauseReason: 'cancelled' })).toBe(false)
  })

  it('opens a connector incident only after the catalog circuit actually fails', () => {
    const base = {
      query: '*',
      total: 67,
      discovered: 67,
      inspected: 4,
      failed: 2,
      incidents: 0,
      governanceGaps: 2,
      concurrency: 4,
      state: 'inspecting' as const,
      checkpointAt: capturedAt,
      datasets: [],
    }

    expect(shouldOpenCatalogConnectivityIncident(base)).toBe(false)
    expect(shouldOpenCatalogConnectivityIncident({ ...base, state: 'failed' })).toBe(true)
  })
})
