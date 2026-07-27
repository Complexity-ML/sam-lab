import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { catalogIdentityKey, governanceGapIssues, hasDataIncident, hasGovernanceGap, inspectCatalogInParallel, inspectWithBoundedRetry, isInspectionUnavailable, mergeCatalogProgress, rankCatalogCandidates, rankCatalogRiskCandidates, resetCatalogRetryState, resolveAdaptiveCatalogConcurrency, shouldCallAgentForCatalog, shouldOpenCatalogConnectivityIncident } from '../domain/catalog-explorer'
import { catalogExplorerCheckpointScope, parseCatalogExplorerPolicy } from '../domain/catalog-explorer-policy'
import type { DataHubAssetSummary, DataHubEvidence } from '../domain/datahub'
import type { CatalogInspection } from '../domain/catalog-connectors'
import type { IncidentEventInput, IncidentSummary } from '../domain/incidents'
import type { AgentProposal, CatalogExplorationProgress, PipelineNode } from '../domain/pipeline'
import { parseWorkerPolicy } from '../domain/worker-policy'

export function useCatalogExplorer(options: {
  incidentSummaries: IncidentSummary[]
  inspectAsset(urn: string, force?: boolean, connectorId?: string, mode?: 'summary' | 'deep'): Promise<CatalogInspection>
  logIncident(event: IncidentEventInput): Promise<void>
  setActivity(value: string): void
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
}) {
  const { incidentSummaries, inspectAsset, logIncident, setActivity, setNodes } = options
  const catalogAssets = useRef(new Map<string, DataHubAssetSummary[]>())
  const latestProgress = useRef(new Map<string, CatalogExplorationProgress>())
  const checkpointWrites = useRef(new Map<string, Promise<void>>())
  const resetRetriesRequested = useRef(false)
  const hashedCheckpointKey = useCallback((value: string) => {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return `catalog:${(hash >>> 0).toString(16).padStart(8, '0')}`
  }, [])
  const checkpointKey = useCallback((explorer: PipelineNode) =>
    hashedCheckpointKey(`${explorer.id}:${catalogExplorerCheckpointScope(explorer.data.rule)}`), [hashedCheckpointKey])
  const legacyCheckpointKey = useCallback((explorer: PipelineNode, query: string) =>
    hashedCheckpointKey(`${explorer.id}:${explorer.data.rule ?? ''}:${query}`), [hashedCheckpointKey])
  const persistProgress = useCallback((key: string, progress: CatalogExplorationProgress) => {
    const previousWrite = checkpointWrites.current.get(key) ?? Promise.resolve()
    const write = previousWrite
      .catch(() => undefined)
      .then(async () => {
        await window.dataLab?.saveCatalogCheckpoint?.(key, progress)
      })
      .catch(() => undefined)
    checkpointWrites.current.set(key, write)
    return write
  }, [])
  const updateProgress = useCallback((explorer: PipelineNode, progress: CatalogExplorationProgress, isCurrent: () => boolean, worker?: PipelineNode) => {
    if (!isCurrent()) return
    const key = checkpointKey(explorer)
    const monotonicProgress = mergeCatalogProgress(latestProgress.current.get(key), progress) ?? progress
    latestProgress.current.set(key, monotonicProgress)
    progress = monotonicProgress
    const connectorPaused = progress.pauseReason === 'connector_unavailable' || progress.pauseReason === 'retry_exhausted'
    const retryExhausted = progress.pauseReason === 'retry_exhausted'
    const scopeLabel = progress.mode === 'dataset' ? 'Focused dataset audit' : 'Connected-catalog audit'
    const phase = retryExhausted
      ? `${scopeLabel} paused — connector unavailable`
      : progress.state === 'failed' || connectorPaused ? `${scopeLabel} paused for connector recovery` : progress.state === 'complete' ? `${scopeLabel} complete` : `${scopeLabel} running`
    const recovering = connectorPaused || progress.concurrency === 1 && (progress.connectorRecoveryStreak ?? 0) < 2
    const audited = progress.dataAudited ?? 0
    const coverageGaps = progress.dataAuditCoverageGaps ?? 0
    const remaining = progress.dataAuditRemaining ?? progress.remaining ?? Math.max(0, progress.total - progress.inspected)
    setNodes((current) => current.map((node) => {
      if (node.id === explorer.id) return {
        ...node,
        data: {
          ...node.data,
          exploration: progress,
          description: `${phase} · ${progress.inspected}/${progress.total || '?'} checked · ${audited} aggregate profile(s) audited · ${coverageGaps} profile coverage gap(s) · ${remaining} queued · ${progress.concurrency} worker(s) · ${progress.incidents} evidence-backed data incident(s) · ${progress.failed} connector read(s) unavailable.`,
          status: progress.state === 'failed' || progress.failed > 0 ? 'warning' : progress.state === 'complete' ? 'healthy' : 'draft',
          runState: progress.state === 'complete' ? 'completed' : progress.state === 'paused' ? 'waiting' : progress.state === 'failed' ? 'failed' : 'running',
        },
      }
      if (worker && node.id === worker.id) return {
        ...node,
        data: {
          ...node.data,
          description: recovering
            ? `Connector recovery · 1 worker · checkpoint preserved · ${progress.connectorRecoveryStreak ?? 0}/2 healthy recovery batches.`
            : `Catalog audit worker · ${progress.concurrency} concurrent task(s) · batch ${progress.batchSize ?? 1} · atomic checkpoint merge.`,
          status: progress.failed > 0 ? 'warning' : 'healthy',
          runState: progress.state === 'complete' ? 'completed' : progress.state === 'paused' ? 'waiting' : 'running',
        },
      }
      return node
    }))
    setActivity(retryExhausted
      ? `Catalog Explorer checkpoint saved · connector unavailable after ${progress.inspected}/${progress.total || '?'} inspections · retry limit reached`
      : progress.state === 'failed' || connectorPaused
      ? `Catalog Explorer checkpoint saved · connector unavailable after ${progress.inspected}/${progress.total || '?'} inspections · retry ${progress.connectorRetryCount ?? 0}/${progress.connectorRetryLimit ?? 3} scheduled`
      : `Catalog Explorer · ${progress.inspected}/${progress.total || '?'} checked · ${audited} aggregate profile(s) audited · ${coverageGaps} coverage gap(s) · ${remaining} queued · ${progress.concurrency} adaptive worker(s) · ${progress.incidents} evidence-backed data incident(s)`)
  }, [checkpointKey, setActivity, setNodes])

  const explore = useCallback(async (input: {
    assets: DataHubAssetSummary[]
    /**
     * Inspect one dataset and expose the first usable governed candidate.
     * The remaining catalog stays checkpointed and continues locally after
     * the first source branch has been committed.
     */
    bootstrapCandidate?: boolean
    explorer: PipelineNode
    worker?: PipelineNode
    isCurrent(): boolean
    query: string
  }) => {
    const policy = parseCatalogExplorerPolicy(input.explorer.data.rule)
    const workerPolicy = input.worker ? parseWorkerPolicy(input.worker.data.rule) : undefined
    const focusedAsset = policy.scope === 'dataset' && policy.datasetUrn
      ? input.assets.find((asset) => asset.urn === policy.datasetUrn || asset.assetRef === policy.datasetUrn)
      : undefined
    if (policy.scope === 'dataset' && policy.datasetUrn && !focusedAsset) {
      throw new Error(`Focused catalog asset "${policy.datasetUrn}" is not present in discovery results; refusing to guess its connector.`)
    }
    const assets = focusedAsset ? [focusedAsset] : input.assets
    const assetByIdentity = new Map(assets.map((asset) => [catalogIdentityKey(asset), asset]))
    catalogAssets.current.set(input.explorer.id, assets)
    const key = checkpointKey(input.explorer)
    await checkpointWrites.current.get(key)?.catch(() => undefined)
    let persistedProgress = await window.dataLab?.loadCatalogCheckpoint?.(key).catch(() => null)
    if (!persistedProgress) {
      const legacyQueries = [...new Set([input.explorer.data.exploration?.query, input.query, '*'].filter((query): query is string => Boolean(query)))]
      for (const query of legacyQueries) {
        persistedProgress = await window.dataLab?.loadCatalogCheckpoint?.(legacyCheckpointKey(input.explorer, query)).catch(() => null)
        if (persistedProgress) {
          persistProgress(key, persistedProgress)
          break
        }
      }
    }
    const mergedProgress = mergeCatalogProgress(
      mergeCatalogProgress(input.explorer.data.exploration, latestProgress.current.get(key)),
      persistedProgress ?? undefined,
    )
    const previousProgress = resetRetriesRequested.current && mergedProgress
      ? resetCatalogRetryState(mergedProgress)
      : mergedProgress
    resetRetriesRequested.current = false
    const configuredConcurrency = policy.scope === 'dataset' ? 1 : workerPolicy?.concurrency ?? policy.concurrency
    const configuredBatchSize = policy.scope === 'dataset' ? 1 : workerPolicy?.batchSize ?? policy.batchSize
    const concurrency = policy.scope === 'dataset'
      ? 1
      : resolveAdaptiveCatalogConcurrency(previousProgress, configuredConcurrency)
    updateProgress(input.explorer, {
      query: input.query,
      total: assets.length,
      discovered: assets.length,
      inspected: previousProgress?.inspected ?? 0,
      dataAudited: previousProgress?.dataAudited ?? 0,
      dataAuditCoverageGaps: previousProgress?.dataAuditCoverageGaps ?? 0,
      dataAuditRemaining: previousProgress?.dataAuditRemaining ?? Math.max(0, assets.length - (previousProgress?.inspected ?? 0)),
      failed: previousProgress?.failed ?? 0,
      incidents: previousProgress?.incidents ?? 0,
      governanceGaps: previousProgress?.governanceGaps ?? 0,
      concurrency,
      batchSize: configuredBatchSize,
      remaining: Math.max(0, assets.length - (previousProgress?.inspected ?? 0)),
      mode: policy.scope === 'dataset' ? 'dataset' : 'catalog',
      cacheMode: policy.cacheMode,
      phase: 'inspect',
      state: 'inspecting',
      checkpointAt: new Date().toISOString(),
      connectorRecoveryStreak: previousProgress?.connectorRecoveryStreak ?? 0,
      datasets: previousProgress?.datasets ?? [],
    }, input.isCurrent, input.worker)

    const explored = await inspectCatalogInParallel(assets, async (assetRef, connectorId) => {
      const asset = assetByIdentity.get(catalogIdentityKey({ connectorId, assetRef, urn: assetRef }))
      if (!asset) throw new Error(`Catalog identity not found for ${connectorId ?? 'unknown'}:${assetRef}`)
      // The summary path reads the connector's aggregate dataset profile alongside
      // entity metadata. It never requests raw rows or sample values. Schema
      // and lineage stay reserved for a newly evidenced risk candidate below.
      const inspection = policy.cacheMode === 'refresh'
        ? await inspectAsset(assetRef, true, connectorId, 'summary')
        : await inspectWithBoundedRetry(
            assetRef,
            (candidateRef, force) => inspectAsset(candidateRef, force, connectorId, 'summary'),
            { retryUnavailable: policy.scope === 'dataset' },
          )
      return inspection
    }, {
      concurrency,
      batchSize: configuredBatchSize,
      cacheMode: policy.cacheMode,
      mode: policy.scope === 'dataset' ? 'dataset' : 'catalog',
      maxInspections: input.bootstrapCandidate ? 1 : configuredBatchSize,
      previous: previousProgress?.datasets,
      previousProgress,
      retryCooldownMs: (workerPolicy?.cooldownSeconds ?? 30) * 1_000,
      retryLimit: workerPolicy?.retry === 'none' ? 1 : workerPolicy?.maxRetries ?? 3,
      query: input.query,
      isCancelled: () => !input.isCurrent(),
      onCheckpoint: (progress) => {
        updateProgress(input.explorer, progress, input.isCurrent, input.worker)
        persistProgress(key, progress)
      },
    })
    await persistProgress(key, explored.progress)

    const evidence: DataHubEvidence[] = explored.inspections.flatMap((inspection) => inspection.evidence)
    const byIdentity = new Map(assets.map((asset) => [catalogIdentityKey(asset), asset]))
    const inspectedByIdentity = new Map(explored.inspections.map((inspection) => [catalogIdentityKey(inspection.asset), inspection.asset]))
    const riskCandidates = rankCatalogRiskCandidates(explored.progress)
    const previousByIdentity = new Map(previousProgress?.datasets.map((checkpoint) => [catalogIdentityKey(checkpoint), checkpoint]) ?? [])
    const hasNewRiskEvidence = riskCandidates.some((current) => {
      const previous = previousByIdentity.get(catalogIdentityKey(current))
      return Boolean(current && (!previous || previous.fingerprint !== current.fingerprint))
    })
    const shouldCallAgent = shouldCallAgentForCatalog(previousProgress, explored.progress, hasNewRiskEvidence)
    const shouldSelectCandidate = shouldCallAgent || Boolean(input.bootstrapCandidate)
    const rankedCandidates = shouldSelectCandidate
      ? riskCandidates.length
        ? riskCandidates
        : rankCatalogCandidates(explored.progress)
      : []
    const candidateCheckpoint = rankedCandidates.find((checkpoint) => inspectedByIdentity.has(catalogIdentityKey(checkpoint)) || byIdentity.has(catalogIdentityKey(checkpoint)))
    let candidate = candidateCheckpoint
      ? inspectedByIdentity.get(catalogIdentityKey(candidateCheckpoint)) ?? byIdentity.get(catalogIdentityKey(candidateCheckpoint))
      : undefined
    if (candidate) {
      const checkpoint = explored.progress.datasets.find((dataset) => catalogIdentityKey(dataset) === catalogIdentityKey(candidate!))
      if (checkpoint && !evidence.some((read) => catalogIdentityKey(read) === catalogIdentityKey(checkpoint) && read.status === 'ok' && !read.stale)) {
        evidence.push({
          connectorId: checkpoint.connectorId,
          sourceSystem: checkpoint.sourceSystem,
          assetRef: checkpoint.assetRef,
          tool: 'catalog_checkpoint',
          urn: checkpoint.urn,
          capturedAt: checkpoint.capturedAt,
          expiresAt: checkpoint.expiresAt,
          status: 'ok',
          summary: `Versioned catalog checkpoint: ${checkpoint.status}; fields=${checkpoint.fieldCount}; owners=${checkpoint.ownerCount}; upstream=${checkpoint.upstreamCount}; downstream=${checkpoint.downstreamCount}.`,
          cached: true,
          stale: Date.parse(checkpoint.expiresAt) <= Date.now(),
        })
      }
      try {
        // One evidence-backed candidate per atomic batch receives the expensive
        // schema + upstream/downstream lineage audit. The remaining catalog
        // assets keep their bounded entity summaries until promoted.
        const hydrated = await inspectAsset(candidate.assetRef ?? candidate.urn, false, candidate.connectorId, 'deep')
        if (!isInspectionUnavailable(hydrated)) candidate = hydrated.asset
        evidence.push(...hydrated.evidence.map((read) => ({
          tool: read.tool,
          urn: hydrated.asset.urn,
          capturedAt: read.capturedAt,
          expiresAt: read.expiresAt,
          status: read.status,
          summary: read.summary,
          cached: read.cached,
          stale: read.stale,
        })))
      } catch { /* Keep the versioned catalog identity as a bounded fallback. */ }
    }
    if (input.isCurrent()) {
      const unavailable = explored.progress.datasets.filter((dataset) => dataset.status === 'unavailable')
      const connectorGroups = new Map<string, typeof unavailable>()
      const freshlyAvailableConnectors = new Map<string, { sourceSystem: string; cardId: string }>()
      explored.inspections.filter((inspection) => !isInspectionUnavailable(inspection)).forEach((inspection) => {
        const asset = inspection.asset
        const key = asset?.connectorId ?? asset?.sourceSystem ?? 'catalog'
        freshlyAvailableConnectors.set(key, {
          sourceSystem: asset?.sourceSystem ?? 'Catalog',
          cardId: input.explorer.id,
        })
      })
      unavailable.forEach((dataset) => {
        const asset = byIdentity.get(catalogIdentityKey(dataset))
        const key = asset?.connectorId ?? asset?.sourceSystem ?? 'catalog'
        connectorGroups.set(key, [...(connectorGroups.get(key) ?? []), dataset])
      })
      const catalogConnectionUnavailable = shouldOpenCatalogConnectivityIncident(explored.progress)
      const recoveredConnectors = [...freshlyAvailableConnectors.entries()].filter(([connector]) => {
        if (catalogConnectionUnavailable && connectorGroups.has(connector)) return false
        return incidentSummaries.some((incident) => incident.incidentKey === `catalog-explorer:connectivity:${connector}` && incident.status !== 'resolved')
      })
      const failedConnectorGroups = catalogConnectionUnavailable ? connectorGroups : new Map<string, typeof unavailable>()
      const recoveredDataIncidents = explored.inspections.flatMap((inspection) => {
        if (isInspectionUnavailable(inspection)) return []
        const dataset = explored.progress.datasets.find((item) => catalogIdentityKey(item) === catalogIdentityKey(inspection.asset))
        const incidentKey = `catalog-explorer:${catalogIdentityKey(inspection.asset)}`
        if (!dataset || hasDataIncident(dataset) || !incidentSummaries.some((incident) => incident.incidentKey === incidentKey && incident.status !== 'resolved')) return []
        return [{ dataset, asset: inspection.asset, incidentKey }]
      })
      const governanceIncidents = explored.progress.datasets.filter(hasGovernanceGap).flatMap((dataset) => {
        const incidentKey = `catalog-explorer:governance:${catalogIdentityKey(dataset)}`
        const existing = incidentSummaries.find((incident) => incident.incidentKey === incidentKey && incident.status !== 'resolved')
        if (existing?.fingerprint === dataset.fingerprint) return []
        return [{
          dataset,
          incidentKey,
          transition: existing ? 'worsened' as const : 'opened' as const,
        }]
      })
      const dataIncidents = explored.progress.datasets.filter(hasDataIncident).flatMap((dataset) => {
        const incidentKey = `catalog-explorer:${catalogIdentityKey(dataset)}`
        const existing = incidentSummaries.find((incident) => incident.incidentKey === incidentKey && incident.status !== 'resolved')
        if (existing?.fingerprint === dataset.fingerprint) return []
        const mostSevereSignal = [...(dataset.dataRiskSignals ?? [])].sort((left, right) => {
          const rank = { critical: 4, high: 3, medium: 2, low: 1 }
          return rank[right.severity] - rank[left.severity]
        })[0]
        return [{
          dataset,
          incidentKey,
          transition: existing ? 'worsened' as const : 'opened' as const,
          severity: mostSevereSignal?.severity === 'critical' || mostSevereSignal?.severity === 'high' ? 'critical' as const : 'warning' as const,
          detail: dataset.dataRiskSignals?.length
            ? dataset.dataRiskSignals.map((signal) => signal.summary).join(' · ')
            : dataset.issues.join(', ') || 'A fresh catalog assertion reported a data-quality incident.',
        }]
      })
      const recoveredGovernanceIncidents = explored.inspections.flatMap((inspection) => {
        if (isInspectionUnavailable(inspection)) return []
        const dataset = explored.progress.datasets.find((item) => catalogIdentityKey(item) === catalogIdentityKey(inspection.asset))
        const incidentKey = `catalog-explorer:governance:${catalogIdentityKey(inspection.asset)}`
        if (!dataset || hasGovernanceGap(dataset) || !incidentSummaries.some((incident) => incident.incidentKey === incidentKey && incident.status !== 'resolved')) return []
        return [{ dataset, asset: inspection.asset, incidentKey }]
      })
      await Promise.all([
        ...[...failedConnectorGroups.entries()].map(([connector, datasets]) => {
          const firstErrors = datasets
            .flatMap((dataset) => dataset.issues)
            .filter((issue) => issue !== 'metadata unavailable')
            .slice(0, 3)
          return logIncident({
            incidentKey: `catalog-explorer:connectivity:${connector}`,
            transition: 'opened' as const,
            severity: 'critical' as const,
            title: `Catalog connection unavailable · ${byIdentity.get(catalogIdentityKey(datasets[0]!))?.sourceSystem ?? connector}`,
            detail: `${datasets.length} dataset inspection(s) failed. The audit stopped before classifying unavailable metadata as dataset health.${firstErrors.length ? ` First errors: ${firstErrors.join(' | ')}` : ''}`,
            sourceSystem: byIdentity.get(catalogIdentityKey(datasets[0]!))?.sourceSystem ?? 'SAM LAB connectivity',
            sourceRef: connector,
            fingerprint: datasets.map((dataset) => dataset.fingerprint).join(':'),
            cardId: input.explorer.id,
            branchId: connector,
          })
        }),
        ...recoveredConnectors.map(([connector, source]) => logIncident({
          incidentKey: `catalog-explorer:connectivity:${connector}`,
          transition: 'recovered' as const,
          severity: 'info' as const,
          title: `Catalog connection restored · ${source.sourceSystem}`,
          detail: 'A fresh bounded catalog inspection completed successfully. Dataset health classification may resume from the saved checkpoint.',
          sourceSystem: source.sourceSystem,
          sourceRef: connector,
          cardId: source.cardId,
          branchId: connector,
        })),
        ...recoveredDataIncidents.map(({ dataset, asset, incidentKey }) => logIncident({
          incidentKey,
          transition: 'recovered' as const,
          severity: 'info' as const,
          title: `Data quality recovered · ${dataset.name}`,
          detail: 'A fresh bounded catalog inspection no longer reports the previous statistical anomaly or failing quality assertion. The previous incident remains available in history.',
          sourceSystem: asset.sourceSystem ?? 'Catalog',
          sourceRef: dataset.assetRef ?? dataset.urn,
          fingerprint: dataset.fingerprint,
          cardId: input.explorer.id,
          branchId: catalogIdentityKey(dataset),
        })),
        ...recoveredGovernanceIncidents.map(({ dataset, asset, incidentKey }) => logIncident({
          incidentKey,
          transition: 'recovered' as const,
          severity: 'info' as const,
          title: `Governance gap recovered · ${dataset.name}`,
          detail: 'A fresh bounded catalog inspection confirms that the previously missing ownership or classification metadata is now present.',
          sourceSystem: asset.sourceSystem ?? 'Catalog',
          sourceRef: dataset.assetRef ?? dataset.urn,
          fingerprint: dataset.fingerprint,
          cardId: input.explorer.id,
          branchId: catalogIdentityKey(dataset),
        })),
        ...governanceIncidents.map(({ dataset, incidentKey, transition }) => logIncident({
          incidentKey,
          transition,
          severity: 'warning' as const,
          title: `Governance gap · ${dataset.name}`,
          detail: governanceGapIssues(dataset).join(', ') || 'Catalog governance metadata is incomplete.',
          sourceSystem: byIdentity.get(catalogIdentityKey(dataset))?.sourceSystem ?? dataset.sourceSystem ?? 'Catalog',
          sourceRef: dataset.assetRef ?? dataset.urn,
          fingerprint: dataset.fingerprint,
          cardId: input.explorer.id,
          branchId: catalogIdentityKey(dataset),
        })),
        ...dataIncidents.map(({ dataset, incidentKey, transition, severity, detail }) => logIncident({
          incidentKey,
          transition,
          severity,
          title: `Data value anomaly · ${dataset.name}`,
          detail,
          sourceSystem: byIdentity.get(catalogIdentityKey(dataset))?.sourceSystem ?? dataset.sourceSystem ?? 'Catalog',
          sourceRef: dataset.assetRef ?? dataset.urn,
          fingerprint: dataset.fingerprint,
          cardId: input.explorer.id,
          branchId: catalogIdentityKey(dataset),
        })),
      ])
    }
    return {
      candidate,
      evidence,
      progress: explored.progress,
      summaries: [
        `Catalog Explorer checkpoint ${explored.progress.inspected}/${explored.progress.total}; ${explored.progress.dataAudited ?? 0} aggregate profiles audited, ${explored.progress.dataAuditCoverageGaps ?? 0} profile coverage gaps, ${explored.progress.incidents} evidence-backed data incidents and ${explored.progress.failed} unavailable reads. Last batch used ${explored.progress.concurrency} workers in ${explored.progress.batchDurationMs ?? 0}ms. Continue from the versioned checkpoint without repeating completed dataset audits.`,
        ...explored.inspections.slice(0, 4).map((inspection) => {
          const dataset = explored.progress.datasets.find((item) => catalogIdentityKey(item) === catalogIdentityKey(inspection.asset))!
          return `${dataset.name} · ${dataset.status} · fields=${dataset.fieldCount} · owners=${dataset.ownerCount} · upstream=${dataset.upstreamCount} · downstream=${dataset.downstreamCount} · issues=${dataset.issues.join(', ') || 'none'}`
        }),
      ],
    }
  }, [checkpointKey, incidentSummaries, inspectAsset, legacyCheckpointKey, logIncident, persistProgress, updateProgress])

  const attachProgress = useCallback((proposal: AgentProposal, explorer: PipelineNode, progress: CatalogExplorationProgress) => {
    const existingUpdate = proposal.updatedNodes.find((update) => update.nodeId === explorer.id)
    const patch = {
      exploration: progress,
      description: `${progress.mode === 'dataset' ? 'Focused dataset audit' : 'Connected-catalog audit'} · ${progress.inspected}/${progress.total} checked · ${progress.dataAudited ?? 0} aggregate profile(s) audited · ${progress.dataAuditCoverageGaps ?? 0} profile coverage gap(s) · ${progress.incidents} evidence-backed data incident(s) · ${progress.failed} unavailable.`,
      status: progress.failed > 0 ? 'warning' as const : 'healthy' as const,
      runState: progress.state === 'complete' ? 'completed' as const : progress.state === 'inspecting' ? 'running' as const : 'stopped' as const,
    }
    if (existingUpdate) existingUpdate.patch = { ...existingUpdate.patch, ...patch }
    else proposal.updatedNodes.push({ nodeId: explorer.id, patch, reason: 'Persist the complete, resumable multi-connector catalog exploration checkpoint.' })
  }, [])

  const markDiscoveryFailed = useCallback((explorer: PipelineNode, query: string, isCurrent: () => boolean) => {
    const key = checkpointKey(explorer)
    const previous = mergeCatalogProgress(explorer.data.exploration, latestProgress.current.get(key))
    const retryCount = (previous?.connectorRetryCount ?? 0) + 1
    const retryLimit = previous?.connectorRetryLimit ?? 3
    const progress = mergeCatalogProgress(previous, {
      query,
      total: previous?.total ?? 0,
      discovered: previous?.discovered ?? 0,
      inspected: previous?.inspected ?? 0,
      dataAudited: previous?.dataAudited ?? 0,
      dataAuditCoverageGaps: previous?.dataAuditCoverageGaps ?? 0,
      dataAuditRemaining: previous?.dataAuditRemaining ?? previous?.remaining ?? Math.max(0, (previous?.total ?? 0) - (previous?.inspected ?? 0)),
      failed: Math.max(1, previous?.failed ?? 0),
      incidents: previous?.incidents ?? 0,
      governanceGaps: previous?.governanceGaps ?? 0,
      concurrency: 1,
      batchSize: previous?.batchSize ?? 8,
      remaining: previous?.remaining ?? Math.max(0, (previous?.total ?? 0) - (previous?.inspected ?? 0)),
      mode: previous?.mode ?? 'catalog',
      cacheMode: previous?.cacheMode ?? 'prefer',
      phase: 'checkpoint',
      state: 'paused',
      pauseReason: retryCount >= retryLimit ? 'retry_exhausted' : 'connector_unavailable',
      connectorRetryCount: retryCount,
      connectorRetryLimit: retryLimit,
      connectorFailureFingerprint: previous?.connectorFailureFingerprint ?? 'catalog-discovery-unavailable',
      nextRetryAt: new Date(Date.now() + 30_000).toISOString(),
      checkpointAt: new Date().toISOString(),
      datasets: previous?.datasets ?? [],
    })!
    updateProgress(explorer, progress, isCurrent)
    void persistProgress(key, progress)
    return progress
  }, [checkpointKey, persistProgress, updateProgress])

  const assetsFor = useCallback((explorerId: string) => catalogAssets.current.get(explorerId) ?? [], [])
  const resetRetriesOnNextExplore = useCallback(() => {
    resetRetriesRequested.current = true
  }, [])

  return { assetsFor, attachProgress, explore, markDiscoveryFailed, resetRetriesOnNextExplore, updateProgress }
}
