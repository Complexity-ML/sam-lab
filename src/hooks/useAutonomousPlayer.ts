import type { Edge } from '@xyflow/react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AgentPlayerState } from '../components/AppHeader'
import type { SettingsSection } from '../components/shared/SettingsModal'
import { materializeAiProposal, type ActiveAiSource } from '../domain/ai'
import { buildPipelineAgentRequest } from '../domain/agent-context'
import { applyAtomicRunState, buildAtomicRunTrace, executePipelineAtomically, isAtomicExecutionCheckpointCurrent, type AtomicPipelineRun } from '../domain/atomic-execution'
import { maximumAtomicRepairAttempts, planAtomicRepair, type AtomicRepairState } from '../domain/atomic-repair'
import type { AutonomyPolicy } from '../domain/autonomy-policy'
import { policyForcesProposalReview } from '../domain/autonomy-policy'
import { ensureAutonomousSystemCards } from '../domain/autonomous-system'
import { classifyConnectivityFailure } from '../domain/connectivity'
import { catalogHasPendingAutonomousWork, rankCatalogRiskCandidateUrns, selectCatalogCandidateUrn, shouldCallAgentForCatalog } from '../domain/catalog-explorer'
import { parseCatalogExplorerPolicy } from '../domain/catalog-explorer-policy'
import type { DataHubAssetSummary, DataHubEvidence } from '../domain/datahub'
import type { CatalogInspection } from '../domain/catalog-connectors'
import { addDataProfileToProposal, canReuseDataProfile, dataProfileEvidence } from '../domain/data-profile'
import { recordDiagnostic } from '../domain/diagnostics'
import type { IncidentEventInput, IncidentSummary } from '../domain/incidents'
import { dataHubDiscoveryQuery, defaultBlankObjective, resolveAgentObjective } from '../domain/agent-objective'
import { applyProposal, type AgentProposal, type CatalogExplorationProgress, type PipelineNode } from '../domain/pipeline'
import { ensureHostReviewCheckpoint } from '../domain/review-checkpoint'
import { evaluateHostRisk, riskAssetsFromGraph, type HostRiskDecision } from '../domain/risk-gate'
import { asksForSeparateWorkspace, selectDataSources, workspaceNameFromObjective, type SourceSelection } from '../domain/source-routing'
import { errorMessage, notifyError, notifyToast } from '../domain/toasts'
import { findEquivalentVersion, graphFingerprint, graphsEquivalent, type PipelineVersion } from '../domain/versioning'
import { atomicTransactionBlockers, validatePipeline, type ValidationIssue } from '../validation'
import { repairMonitorWorkBranches, repairSensitiveOutputPaths } from '../validation/proposal-repair'
import { parseWorkerPolicy } from '../domain/worker-policy'
import { disconnectedAiStatus, disconnectedChatGPTStatus } from './useAiConnections'
import { useCatalogExplorer } from './useCatalogExplorer'
import { findBoundLiveMonitors, liveMonitorBindingKey, type PostCorrectionVerification } from '../domain/live-monitor'
import { useLiveIncidentMonitor, type LiveIncidentTrigger } from './useLiveIncidentMonitor'

type ContextMenu = { nodeId: string; label: string; x: number; y: number }
type MutableRef<T> = { current: T }

interface AutonomousPlayerOptions {
  active: { connected: boolean; label: string }
  activeAiSource: ActiveAiSource
  activeAtomicRun: MutableRef<AtomicPipelineRun | undefined>
  agentRunId: MutableRef<number>
  autonomyPolicy: AutonomyPolicy
  commitAutonomousProposal(proposal: AgentProposal, options?: { preservePendingReview?: boolean; executionNodes?: PipelineNode[] }): string | undefined
  discardInvalidProposal(blockerIds: string[]): void
  connectionMode: 'demo' | 'connected'
  edges: Edge[]
  fitCommittedGraph(nodeIds?: Iterable<string>): void
  inspectDataHubAsset(urn: string, force?: boolean, connectorId?: string, mode?: 'summary' | 'deep'): Promise<CatalogInspection>
  inspectorOpen: boolean
  issues: ValidationIssue[]
  language: string
  libraryOpen: boolean
  logIncident(event: IncidentEventInput): Promise<void>
  incidentSummaries: IncidentSummary[]
  nodes: PipelineNode[]
  pendingVersionId?: string
  projectTitle: string
  proposal?: AgentProposal
  recordAudit(transport: 'http' | 'stdio', completedReads: number, totalReads: number): void
  recordPendingReview(proposal: AgentProposal): string
  rejectProposal(): void
  resumePlayerAfterReview: MutableRef<boolean>
  reviewAssistant: { busy: boolean; stop(): void }
  searchDataHubAssets(query: string): Promise<DataHubAssetSummary[]>
  setActivity(message: string): void
  setContextMenu: Dispatch<SetStateAction<ContextMenu | undefined>>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setProjectTitle: Dispatch<SetStateAction<string>>
  setProposal: Dispatch<SetStateAction<AgentProposal | undefined>>
  setProposalReviewOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setSettingsSection: Dispatch<SetStateAction<SettingsSection>>
  versions: PipelineVersion[]
  workspace: {
    activeWorkspaceId?: string | null
    createWorkspace(name: string, snapshot?: {
      projectTitle: string
      nodes: PipelineNode[]
      edges: Edge[]
      versions: PipelineVersion[]
      projectSettings: { inspectorOpen: boolean; libraryOpen: boolean }
    }): Promise<unknown>
    saveWorkspace(): Promise<unknown>
  }
  writeDataHubDecision(input: {
    revisionId: string
    title: string
    rationale: string
    author: string
    relatedAssets: string[]
  }): Promise<{ summary: string }>
  approveProposal(): boolean
}

function evidenceFromMonitor(trigger: LiveIncidentTrigger): DataHubEvidence[] {
  return trigger.audit.reads.map((read) => ({
    tool: read.capability ?? read.name,
    urn: trigger.monitor.urn,
    capturedAt: read.capturedAt,
    expiresAt: read.expiresAt,
    status: read.status,
    summary: read.summary,
    cached: read.cached,
    stale: read.stale,
  }))
}

function monitorHostRisk(trigger: LiveIncidentTrigger, policy: AutonomyPolicy): HostRiskDecision {
  return evaluateHostRisk(trigger.audit.asset ? [trigger.audit.asset] : [], evidenceFromMonitor(trigger), policy)
}

export function useAutonomousPlayer(options: AutonomousPlayerOptions) {
  const {
    active, activeAiSource, activeAtomicRun, agentRunId, autonomyPolicy, commitAutonomousProposal, discardInvalidProposal,
    connectionMode, edges, fitCommittedGraph, incidentSummaries, inspectDataHubAsset, inspectorOpen,
    issues, language, libraryOpen, logIncident, nodes, pendingVersionId, projectTitle, proposal,
    recordAudit, recordPendingReview, rejectProposal, resumePlayerAfterReview, reviewAssistant,
    searchDataHubAssets, setActivity, setContextMenu, setNodes, setProjectTitle, setProposal,
    setProposalReviewOpen, setSettingsOpen, setSettingsSection, versions, workspace,
    writeDataHubDecision, approveProposal,
  } = options
  const [agentRunning, setAgentRunning] = useState(false)
  const [playerStarting, setPlayerStarting] = useState(false)
  const [playerState, setPlayerState] = useState<AgentPlayerState>('stopped')
  const [proposalApprovalBusy, setProposalApprovalBusy] = useState(false)
  const [pendingWorkspacePrompt, setPendingWorkspacePrompt] = useState<string>()
  const [autonomousStepRequest, setAutonomousStepRequest] = useState<{ objective: string; sessionId: number; stepId: number }>()
  const [autonomousStepScheduled, setAutonomousStepScheduled] = useState(false)
  const playerSessionId = useRef(0)
  const playerStartupBlocked = useRef(false)
  const proposalApprovalRunning = useRef(false)
  const monitorBootstrapAttempted = useRef(false)
  const catalogAdvanceAttempted = useRef(new Set<string>())
  const autonomousStepTimer = useRef<number | undefined>(undefined)
  const autonomousStepId = useRef(0)
  const autonomousSchedulingBlocked = useRef(true)
  const atomicRepairState = useRef<AtomicRepairState | undefined>(undefined)
  const correctionVerifications = useRef(new Map<string, PostCorrectionVerification>())
  const reviewRepairPending = useRef(false)
  const [reviewBlockedBranchId, setReviewBlockedBranchId] = useState<string>()
  const [deferredReviewTriggers, setDeferredReviewTriggers] = useState<LiveIncidentTrigger[]>([])
  const catalog = useCatalogExplorer({ incidentSummaries, inspectAsset: inspectDataHubAsset, logIncident, setActivity, setNodes })

  const queueAutonomousStep = (objective: string, sessionId = playerSessionId.current, delayMs = 650) => {
    if (autonomousSchedulingBlocked.current || playerSessionId.current !== sessionId) return
    if (autonomousStepTimer.current !== undefined) window.clearTimeout(autonomousStepTimer.current)
    const stepId = ++autonomousStepId.current
    setAutonomousStepScheduled(true)
    setActivity(delayMs > 1_000 ? 'Autonomous retry scheduled · waiting for fresh external evidence…' : 'Next autonomous iteration scheduled · rereading the graph and checkpoint…')
    autonomousStepTimer.current = window.setTimeout(() => {
      autonomousStepTimer.current = undefined
      if (
        autonomousSchedulingBlocked.current
        || playerSessionId.current !== sessionId
        || autonomousStepId.current !== stepId
      ) {
        if (autonomousStepId.current === stepId) setAutonomousStepScheduled(false)
        return
      }
      setActivity('Autonomous iteration starting · reading the current graph and checkpoint…')
      setAutonomousStepRequest({ objective, sessionId, stepId })
    }, delayMs)
  }

  const auditWithAgent = async (agentRequest = defaultBlankObjective, monitored?: LiveIncidentTrigger, expectedPlayerSessionId?: number) => {
    const independentBranchDuringReview = Boolean(
      monitored
      && proposal
      && reviewBlockedBranchId !== monitored.monitor.monitorId,
    )
    const routingPreview: SourceSelection = monitored
      ? {
          mode: 'single',
          sources: nodes.filter((node) => node.id === monitored.monitor.sourceId && node.data.datahubUrn === monitored.monitor.urn),
          matchedTerms: [monitored.monitor.sourceLabel],
        }
      : selectDataSources(nodes, agentRequest)
    const objective = resolveAgentObjective(agentRequest, { hasGraph: nodes.length > 0, matchedSource: routingPreview.matchedTerms.length > 0 })
    if (!objective.accepted) {
      setActivity('Request outside SAM LAB scope · no provider call · graph unchanged')
      notifyToast('Ask about datasets, lineage, incidents, cards or graph operations.', 'info', 'No data action detected')
      return
    }
    agentRequest = objective.objective
    setContextMenu(undefined)
    if (!independentBranchDuringReview) setProposal(undefined)
    if (!window.dataLab) {
      setActivity('AI provider unavailable in web preview · launch the Electron application')
      return
    }
    const [currentAiStatus, currentChatGPT] = await Promise.all([
      window.dataLab.getAiStatus().catch(() => disconnectedAiStatus),
      window.dataLab.getChatGPTStatus().catch(() => disconnectedChatGPTStatus),
    ])
    if (expectedPlayerSessionId !== undefined && playerSessionId.current !== expectedPlayerSessionId) return
    const activeConnected = activeAiSource === 'chatgpt' ? currentChatGPT.connected : currentAiStatus.providers[activeAiSource].connected
    if (!activeConnected) {
      setSettingsSection('ai')
      setSettingsOpen(true)
      setActivity(`${active.label} is the active agent source but is not connected · open Settings → AI connection`)
      return
    }
    if (!monitored && nodes.length > 0 && asksForSeparateWorkspace(agentRequest)) {
      const workspaceName = workspaceNameFromObjective(agentRequest)
      try {
        setActivity('Saving the current graph before creating the explicitly requested workspace…')
        await workspace.saveWorkspace()
        setPendingWorkspacePrompt(agentRequest)
        await workspace.createWorkspace(workspaceName, {
          projectTitle: workspaceName,
          nodes: [],
          edges: [],
          versions: [],
          projectSettings: { inspectorOpen, libraryOpen },
        })
        setActivity(`Separate workspace created · ${workspaceName} · preserved prompt will start on the blank graph`)
      } catch (error) {
        setPendingWorkspacePrompt(undefined)
        notifyError(error, 'Unable to create the separate workspace')
        setActivity(`Separate workspace creation failed · ${errorMessage(error, 'SQLite unavailable')} · current graph preserved`)
      }
      return
    }

    setAgentRunning(true)
    const runId = ++agentRunId.current
    const atomicRun = executePipelineAtomically(nodes, edges)
    activeAtomicRun.current = atomicRun
    const executionNodes = applyAtomicRunState(nodes, atomicRun)
    setNodes((current) => applyAtomicRunState(current, atomicRun))
    const executionCheckpointCurrent = isAtomicExecutionCheckpointCurrent(atomicRun)
    const hasArmedMonitor = nodes.some((node) => node.data.kind === 'monitor')
    const checkpointExplorer = nodes.find((node) => node.data.kind === 'explorer' && node.data.explorerMode === 'catalog-fanout')
    const checkpointProgress = checkpointExplorer?.data.exploration
    const representedCatalogUrns = nodes.flatMap((node) => {
      if (node.data.kind !== 'source') return []
      const urn = node.data.assetRef ?? node.data.datahubUrn
      return urn ? [urn] : []
    })
    const pendingCatalogRiskUrn = checkpointProgress?.state === 'complete'
      ? rankCatalogRiskCandidateUrns(checkpointProgress, representedCatalogUrns)[0]
      : undefined
    const hasPendingCatalogWork = catalogHasPendingAutonomousWork(checkpointProgress, representedCatalogUrns)
    if (!monitored && executionCheckpointCurrent && (hasArmedMonitor || monitorBootstrapAttempted.current) && !hasPendingCatalogWork) {
      const coverageGaps = checkpointProgress?.dataAuditCoverageGaps ?? 0
      setActivity(coverageGaps > 0
        ? `Catalog metadata complete · ${coverageGaps} dataset${coverageGaps === 1 ? '' : 's'} lack aggregate value-profile evidence · graph preserved · connect or ingest DataHub profiles to continue value anomaly detection`
        : hasArmedMonitor
          ? 'All cards are current · execution checkpoint preserved · Live Monitor is waiting for new evidence'
          : 'All cards are current · execution checkpoint preserved · waiting for a graph or evidence change')
      setAgentRunning(false)
      return
    }
    setActivity('Agent reading the current graph, atomic findings and version history…')
    const sourceSelection = routingPreview
    const routedSources = sourceSelection.sources
    const hasDataSource = nodes.some((node) => node.data.kind === 'source')
    const unboundSource = nodes.find((node) => node.data.kind === 'source' && !(node.data.assetRef || node.data.datahubUrn))
    const catalogExplorer = nodes.find((node) => node.data.kind === 'explorer' && node.data.explorerMode === 'catalog-fanout')
    const catalogWorker = nodes.find((node) => node.data.kind === 'worker'
      && node.data.workerMode === 'bounded-execution'
      && parseWorkerPolicy(node.data.rule).role === 'exploration')
    const explorerPolicy = catalogExplorer ? parseCatalogExplorerPolicy(catalogExplorer.data.rule) : undefined
    const explorerWorkerPolicy = catalogWorker ? parseWorkerPolicy(catalogWorker.data.rule) : undefined
    let datahubEvidence: string[] = []
    let evidenceEntries: DataHubEvidence[] = []
    let blankCandidate: DataHubAssetSummary | undefined
    let catalogProgress: CatalogExplorationProgress | undefined
    let continueCatalogWithoutModel = false
    const profileCandidates = new Map<string, DataHubAssetSummary>()
    try {
      if (routedSources.length > 0) {
        for (const [sourceIndex, source] of routedSources.entries()) {
          const sourceUrn = source.data.assetRef ?? source.data.datahubUrn!
          const sourceProfile = nodes.find((node) => node.data.kind === 'profile' && node.data.profile?.sourceUrn === sourceUrn)
          const forcedMonitorAudit = monitored?.monitor.urn === sourceUrn ? monitored.audit : undefined
          if (sourceProfile?.data.profile && canReuseDataProfile(sourceProfile.data.profile, Boolean(forcedMonitorAudit))) {
            setActivity(`Agent reusing ${sourceProfile.data.label} · source ${sourceIndex + 1}/${routedSources.length}…`)
            const remembered = dataProfileEvidence(sourceProfile.data.profile)
            datahubEvidence.push(...remembered.summaries.map((summary) => `${source.data.label} · ${summary}`))
            evidenceEntries.push(...remembered.evidence)
            continue
          }

          if (source.data.connectorId && source.data.connectorId !== 'datahub') {
            const sourceSystem = source.data.sourceSystem ?? source.data.connectorId
            setActivity(`Agent reading ${source.data.label} through ${sourceSystem} · source ${sourceIndex + 1}/${routedSources.length}…`)
            try {
              const inspection = await inspectDataHubAsset(sourceUrn, Boolean(forcedMonitorAudit), source.data.connectorId)
              if (agentRunId.current !== runId) return
              profileCandidates.set(sourceUrn, inspection.asset)
              evidenceEntries.push(...inspection.evidence)
              datahubEvidence.push(...inspection.evidence.map((read) => `${source.data.label} · ${read.tool} · ${read.status} · ${read.summary}`))
              const failedReads = inspection.evidence.filter((read) => read.status !== 'ok' || read.stale)
              await logIncident({
                incidentKey: `${source.data.connectorId}-evidence:${sourceUrn}`,
                transition: failedReads.length ? 'opened' : 'recovered',
                severity: failedReads.length === inspection.evidence.length ? 'critical' : failedReads.length ? 'warning' : 'info',
                title: `${sourceSystem} evidence · ${source.data.label}`,
                detail: failedReads.length ? `${failedReads.length}/${inspection.evidence.length} connector reads failed or became stale.` : 'All required connector reads returned to normal.',
                sourceSystem,
                sourceRef: sourceUrn,
                fingerprint: inspection.evidence.map((read) => `${read.tool}:${read.status}:${read.stale}`).join('|'),
                cardId: source.id,
                branchId: source.id,
              })
            } catch (error) {
              const detail = errorMessage(error, `${sourceSystem} inspection failed`)
              const connectivity = classifyConnectivityFailure(error, `${sourceSystem} · ${source.data.label}`)
              await logIncident({
                incidentKey: `${source.data.connectorId}-evidence:${sourceUrn}`,
                transition: 'opened',
                severity: 'critical',
                title: connectivity?.title ?? `${sourceSystem} evidence · ${source.data.label}`,
                detail: connectivity?.detail ?? detail,
                sourceSystem: connectivity?.sourceSystem ?? sourceSystem,
                sourceRef: sourceUrn,
                fingerprint: connectivity?.fingerprint ?? 'connector-transport-error',
                cardId: source.id,
                branchId: source.id,
              })
            }
            continue
          }

          setActivity(`Agent reading ${source.data.label} through the governed DataHub evidence route · source ${sourceIndex + 1}/${routedSources.length}…`)
          let audit: Awaited<ReturnType<NonNullable<typeof window.dataLab>['auditDataHubWithMcp']>>
          try {
            audit = forcedMonitorAudit ?? await window.dataLab.auditDataHubWithMcp(sourceUrn)
          } catch (error) {
            const detail = errorMessage(error, 'DataHub audit failed')
            const connectivity = classifyConnectivityFailure(error, `DataHub · ${source.data.label}`)
            datahubEvidence.push(`${source.data.label} (${sourceUrn}) · audit error · ${detail}`)
            await logIncident({
              incidentKey: monitored?.incidentKey ?? `datahub-evidence:${sourceUrn}`,
              transition: 'opened',
              severity: 'critical',
              title: connectivity?.title ?? `DataHub evidence · ${source.data.label}`,
              detail: connectivity?.detail ?? detail,
              sourceSystem: connectivity?.sourceSystem ?? 'DataHub',
              sourceRef: sourceUrn,
              fingerprint: connectivity?.fingerprint ?? 'audit-transport-error',
              cardId: source.id,
              branchId: monitored?.monitor.monitorId ?? source.id,
            })
            continue
          }
          if (agentRunId.current !== runId) return
          const successfulReads = audit.reads.filter((read) => read.status === 'ok').length
          datahubEvidence.push(...audit.reads.map((read) => `${source.data.label} · ${read.capability ?? read.name} · ${read.status} · ${read.summary}`))
          evidenceEntries.push(...audit.reads.map((read) => ({
            tool: read.capability ?? read.name,
            urn: sourceUrn,
            capturedAt: read.capturedAt,
            expiresAt: read.expiresAt,
            status: read.status,
            summary: read.summary,
            cached: read.cached,
            stale: read.stale,
          })))
          const failedReads = audit.reads.filter((read) => read.status !== 'ok' || read.stale)
          const connectivity = failedReads.length === audit.reads.length
            ? classifyConnectivityFailure(failedReads.map((read) => read.summary).join(' | '), `DataHub · ${source.data.label}`)
            : undefined
          await logIncident({
            incidentKey: monitored?.incidentKey ?? `datahub-evidence:${sourceUrn}`,
            transition: failedReads.length ? 'opened' : 'recovered',
            severity: failedReads.length === audit.reads.length ? 'critical' : failedReads.length ? 'warning' : 'info',
            title: connectivity?.title ?? `DataHub evidence · ${source.data.label}`,
            detail: connectivity?.detail ?? (failedReads.length
              ? `${failedReads.length}/${audit.reads.length} metadata reads failed or became stale: ${failedReads.map((read) => read.name).join(', ')}.`
              : 'All required DataHub metadata reads returned to normal.'),
            sourceSystem: connectivity?.sourceSystem ?? 'DataHub',
            sourceRef: sourceUrn,
            fingerprint: connectivity?.fingerprint ?? audit.reads.map((read) => `${read.name}:${read.status}:${read.stale}`).join('|'),
            cardId: source.id,
            branchId: monitored?.monitor.monitorId ?? source.id,
          })
          recordAudit(audit.transport, successfulReads, audit.reads.length)
          const inspection = await inspectDataHubAsset(sourceUrn, Boolean(forcedMonitorAudit), source.data.connectorId).catch(() => undefined)
          if (inspection?.asset) profileCandidates.set(sourceUrn, inspection.asset)
        }
        if (!monitored && catalogExplorer && catalogExplorer.data.exploration?.state !== 'complete' && connectionMode === 'connected') {
          const batchLabel = explorerPolicy?.scope === 'dataset' ? 'the focused dataset' : `the next ${explorerWorkerPolicy?.batchSize ?? explorerPolicy?.batchSize ?? 8} datasets`
          setActivity(`Catalog Explorer reading ${batchLabel} with adaptive bounded workers (1–8)…`)
          const previousProgress = catalogExplorer.data.exploration
          let candidates = catalog.assetsFor(catalogExplorer.id)
          if (!candidates.length && explorerPolicy?.scope !== 'dataset') candidates = await searchDataHubAssets('*')
          const explored = await catalog.explore({
            assets: candidates,
            explorer: catalogExplorer,
            worker: catalogWorker,
            query: catalogExplorer.data.exploration?.query ?? '*',
            isCurrent: () => agentRunId.current === runId,
          })
          catalogProgress = explored.progress
          evidenceEntries.push(...explored.evidence)
          datahubEvidence.push(...explored.summaries)
          continueCatalogWithoutModel = !shouldCallAgentForCatalog(previousProgress, explored.progress)
        }
        if (!monitored && catalogExplorer?.data.exploration?.state === 'complete' && connectionMode === 'connected') {
          const representedUrns = nodes.flatMap((node) => {
            if (node.data.kind !== 'source') return []
            const urn = node.data.assetRef ?? node.data.datahubUrn
            return urn ? [urn] : []
          })
          const riskCandidateUrn = rankCatalogRiskCandidateUrns(catalogExplorer.data.exploration, representedUrns)[0]
          if (riskCandidateUrn) {
            setActivity('Catalog risk candidate found · running one focused GraphQL evidence check…')
            const inspection = await inspectDataHubAsset(riskCandidateUrn, false, undefined, 'deep')
            if (agentRunId.current !== runId) return
            blankCandidate = inspection.asset
            catalogProgress = catalogExplorer.data.exploration
            profileCandidates.set(inspection.asset.urn, inspection.asset)
            evidenceEntries.push(...inspection.evidence)
            datahubEvidence.unshift(
              `Autonomous catalog risk candidate selected from the terminal checkpoint: ${inspection.asset.name} (${inspection.asset.urn}).`,
              'Use one registered Query Check for this dataset, then build only the focused Source -> Data Profile -> Impact Analysis -> Risk Assessment branch supported by fresh evidence. Keep the complete Catalog Explorer closed.',
              ...inspection.evidence.map((read) => `${read.tool} · ${read.status} · ${read.summary}`),
            )
          }
        }
      } else if ((!hasDataSource || unboundSource) && connectionMode === 'connected') {
        let candidates: DataHubAssetSummary[] = catalogExplorer ? catalog.assetsFor(catalogExplorer.id) : []
        let discoveryError: unknown
        const discoveryQuery = dataHubDiscoveryQuery(agentRequest)
        const completedCheckpoint = catalogExplorer?.data.exploration?.state === 'complete'
          ? catalogExplorer.data.exploration
          : undefined
        if (completedCheckpoint) {
          catalogProgress = completedCheckpoint
          setActivity(`Catalog Explorer checkpoint ${completedCheckpoint.inspected}/${completedCheckpoint.total} complete · restoring the reviewed source for one targeted repair…`)
          try {
            const preferredSources = [...versions].reverse().flatMap((version) => version.nodes.flatMap((node) => {
              if (node.data.kind !== 'source') return []
              const urn = node.data.assetRef ?? node.data.datahubUrn
              return urn ? [{ urn, connectorId: node.data.connectorId }] : []
            }))
            const candidateUrn = selectCatalogCandidateUrn(completedCheckpoint, preferredSources.map((source) => source.urn))
            if (!candidates.length && !candidateUrn && explorerPolicy?.scope !== 'dataset') candidates = await searchDataHubAssets('*')
            const summary = candidates.find((candidate) => candidate.urn === candidateUrn || candidate.assetRef === candidateUrn)
            if (candidateUrn) {
              const connectorId = preferredSources.find((source) => source.urn === candidateUrn)?.connectorId ?? summary?.connectorId
              const inspection = await inspectDataHubAsset(candidateUrn, false, connectorId, 'deep')
              if (agentRunId.current !== runId) return
              blankCandidate = inspection.asset
              evidenceEntries = inspection.evidence
              datahubEvidence = [
                `Completed Catalog Explorer checkpoint restored without reopening discovery: ${completedCheckpoint.inspected}/${completedCheckpoint.total} datasets.`,
                `Targeted repair source restored from version memory: ${inspection.asset.name} (${inspection.asset.urn}).`,
                ...inspection.evidence.map((read) => `${read.tool} · ${read.status} · ${read.summary}`),
              ]
            }
          } catch (error) {
            discoveryError = error
          }
        } else {
          setActivity(`${unboundSource ? 'Unbound source' : 'Blank canvas'} · agent is discovering a starting dataset through DataHub MCP…`)
          if (catalogExplorer) {
            const checkpoint = catalogExplorer.data.exploration
            catalog.updateProgress(catalogExplorer, {
              query: discoveryQuery,
              total: checkpoint?.total ?? 0,
              discovered: checkpoint?.discovered ?? 0,
              inspected: checkpoint?.inspected ?? 0,
              dataAudited: checkpoint?.dataAudited ?? 0,
              dataAuditCoverageGaps: checkpoint?.dataAuditCoverageGaps ?? 0,
              dataAuditRemaining: checkpoint?.dataAuditRemaining ?? checkpoint?.remaining ?? Math.max(0, (checkpoint?.total ?? 0) - (checkpoint?.inspected ?? 0)),
              failed: checkpoint?.failed ?? 0,
              incidents: checkpoint?.incidents ?? 0,
              governanceGaps: checkpoint?.governanceGaps ?? 0,
              concurrency: explorerPolicy?.scope === 'dataset' ? 1 : explorerPolicy?.concurrency ?? checkpoint?.concurrency ?? 4,
              batchSize: explorerPolicy?.scope === 'dataset' ? 1 : explorerPolicy?.batchSize ?? checkpoint?.batchSize ?? 8,
              remaining: checkpoint?.remaining ?? Math.max(0, (checkpoint?.total ?? 0) - (checkpoint?.inspected ?? 0)),
              mode: explorerPolicy?.scope === 'dataset' ? 'dataset' : checkpoint?.mode ?? 'catalog',
              cacheMode: explorerPolicy?.cacheMode ?? checkpoint?.cacheMode ?? 'prefer',
              phase: 'discover',
              state: 'discovering',
              checkpointAt: new Date().toISOString(),
              datasets: checkpoint?.datasets ?? [],
            }, () => agentRunId.current === runId)
          }
          try {
            if (!candidates.length && explorerPolicy?.scope !== 'dataset') candidates = await searchDataHubAssets(discoveryQuery)
          }
          catch (error) { discoveryError = error }
          if (!candidates.length && discoveryQuery !== '*' && explorerPolicy?.scope !== 'dataset') {
            try { candidates = await searchDataHubAssets('*') }
            catch (error) { discoveryError = error }
          }
          if ((candidates.length || explorerPolicy?.scope === 'dataset') && agentRunId.current === runId) {
            const previousProgress = catalogExplorer?.data.exploration
            const explored = catalogExplorer ? await catalog.explore({
              assets: candidates,
              bootstrapCandidate: true,
              explorer: catalogExplorer,
              worker: catalogWorker,
              query: discoveryQuery,
              isCurrent: () => agentRunId.current === runId,
            }) : undefined
            if (explored) {
              catalogProgress = explored.progress
              evidenceEntries = explored.evidence
              blankCandidate = explored.candidate
              datahubEvidence = explored.summaries
              const reachedFastLaneBoundary = Boolean(explored.candidate)
              continueCatalogWithoutModel = !reachedFastLaneBoundary
                && !shouldCallAgentForCatalog(previousProgress, explored.progress)
            }
          }
        }
        if (blankCandidate) {
          profileCandidates.set(blankCandidate.urn, blankCandidate)
          datahubEvidence.unshift(
            `${catalogProgress?.state === 'complete' ? 'Starting dataset candidate selected after complete catalog exploration' : 'Fast-lane starting dataset selected from the first usable catalog checkpoint'}: ${blankCandidate.name} (${blankCandidate.urn}). Add it as the Data Source card in the proposed graph. ${catalogProgress?.state === 'complete' ? '' : 'Keep Catalog Explorer resumable; the remaining datasets continue in background without model calls.'}`,
            `Selected schema: ${blankCandidate.fields.map((field) => `${field.name}:${field.type}${field.tags?.length ? `[${field.tags.join(',')}]` : ''}`).join(', ') || 'unavailable'}`,
            `Selected governance: owners=${blankCandidate.owners.join(', ') || 'missing'}; tags=${blankCandidate.tags.join(', ') || 'none'}; quality=${blankCandidate.qualityStatus}; upstream=${blankCandidate.upstream.length}; downstream=${blankCandidate.downstream.length}`,
          )
          if (incidentSummaries.some((incident) => incident.incidentKey === 'source-discovery:datahub' && incident.status !== 'resolved')) {
            await logIncident({
              incidentKey: 'source-discovery:datahub',
              transition: 'recovered',
              severity: 'info',
              title: 'DataHub source discovery recovered',
              detail: `Catalog Explorer audited ${catalogProgress?.inspected ?? 0} datasets and selected ${blankCandidate.name}; autonomous source selection can continue.`,
              sourceSystem: 'DataHub',
              sourceRef: blankCandidate.urn,
              fingerprint: `source-discovery-recovered:${blankCandidate.urn}`,
              cardId: unboundSource?.id,
              branchId: unboundSource?.id,
            })
          }
        } else if (!continueCatalogWithoutModel) {
          if (catalogExplorer && discoveryError) catalogProgress = catalog.markDiscoveryFailed(catalogExplorer, discoveryQuery, () => agentRunId.current === runId)
          const connectivity = discoveryError ? classifyConnectivityFailure(discoveryError, 'DataHub source discovery') : undefined
          const failed = discoveryError !== undefined
          const discoveryFailure = failed ? errorMessage(discoveryError, 'Unknown search error') : ''
          if (failed) recordDiagnostic({
            category: 'mcp',
            action: 'catalog.search',
            status: 'error',
            detail: { message: discoveryFailure },
          })
          await logIncident({
            incidentKey: 'source-discovery:datahub',
            transition: 'opened',
            severity: connectivity ? 'critical' : 'warning',
            title: connectivity?.title ?? (failed ? 'DataHub source discovery failed' : 'No governed DataHub source matched'),
            detail: connectivity ? `${connectivity.detail} Technical detail: ${discoveryFailure}.` : (failed
              ? `The DataHub catalog search failed: ${discoveryFailure}. This is a collection-reliability incident; dataset health was not evaluated.`
              : 'The DataHub catalog search completed, but no governed starting dataset matched the autonomous objective. The player will retry without calling the model again.'),
            sourceSystem: connectivity?.sourceSystem ?? 'DataHub',
            sourceRef: 'mcp-search',
            fingerprint: connectivity?.fingerprint ?? (failed ? `source-discovery-error:${errorMessage(discoveryError)}` : 'no-governed-source-candidate'),
            cardId: unboundSource?.id,
            branchId: unboundSource?.id,
          })
          if (unboundSource && catalogProgress?.pauseReason !== 'retry_exhausted' && expectedPlayerSessionId !== undefined && playerSessionId.current === expectedPlayerSessionId) {
            queueAutonomousStep('Retry governed DataHub source discovery for the existing unbound Data Source. Do not propose another placeholder or duplicate graph.', expectedPlayerSessionId, 30_000)
            setActivity(`Incident reported · ${connectivity?.title ?? (failed ? 'DataHub source discovery failed' : 'no governed DataHub source matched')} · autonomous retry in 30 seconds`)
          } else if (unboundSource && catalogProgress?.pauseReason === 'retry_exhausted') {
            setActivity(`Catalog Explorer paused at ${catalogProgress.inspected}/${catalogProgress.total || '?'} · retry limit reached · reconnect the catalog to resume`)
          }
          if (unboundSource) return
          datahubEvidence = ['No governed DataHub source matched the objective. The graph has no Data Source yet. Add one explicit unbound Data Source and one Human Review binding checkpoint without inventing schema, ownership or lineage.']
        }
      } else if (unboundSource) {
        await logIncident({
          incidentKey: 'source-discovery:datahub',
          transition: 'opened',
          severity: 'critical',
          title: 'DataHub connection required',
          detail: 'The autonomous graph contains an unbound Data Source, but DataHub MCP is not connected. Monitoring and impact analysis cannot begin.',
          sourceSystem: 'DataHub',
          sourceRef: 'mcp',
          fingerprint: 'datahub-disconnected',
          cardId: unboundSource.id,
          branchId: unboundSource.id,
        })
        if (expectedPlayerSessionId !== undefined && playerSessionId.current === expectedPlayerSessionId) {
          queueAutonomousStep('Retry the existing unbound Data Source after DataHub MCP becomes available. Do not add another placeholder.', expectedPlayerSessionId, 30_000)
          setActivity('Incident reported · DataHub MCP is required · autonomous retry in 30 seconds')
        }
        return
      } else {
        datahubEvidence = ['No bounded DataHub source matched the prompt. Treat evidence as incomplete and do not modify an unrelated source branch.']
      }

      if ((catalogProgress?.state === 'failed' || catalogProgress?.pauseReason === 'connector_unavailable') && expectedPlayerSessionId !== undefined) {
        queueAutonomousStep('Retry the versioned Catalog Explorer checkpoint after the connector becomes available. Do not call the model until fresh catalog evidence is collected.', expectedPlayerSessionId, 30_000)
        setActivity(`Catalog Explorer paused at ${catalogProgress.inspected}/${catalogProgress.total} · connector retry in 30 seconds · model not called`)
        return
      }
      if (catalogProgress?.pauseReason === 'retry_exhausted') {
        setActivity(`Catalog Explorer paused at ${catalogProgress.inspected}/${catalogProgress.total || '?'} · connector retry limit reached · graph checkpoint preserved`)
        return
      }
      if (continueCatalogWithoutModel && catalogProgress) {
        if (catalogProgress.state !== 'complete' && expectedPlayerSessionId !== undefined) {
          queueAutonomousStep('Continue the next local Catalog Explorer aggregate-profile batch from its versioned checkpoint. Call the model only when a new evidence-backed data risk is found.', expectedPlayerSessionId, 120)
          setActivity(`Catalog checkpoint ${catalogProgress.inspected}/${catalogProgress.total} · ${catalogProgress.dataAudited ?? 0} aggregate profiles audited · no new data risk · continuing locally without model tokens`)
        } else {
          setActivity(`Dataset audit complete · ${catalogProgress.dataAudited ?? 0}/${catalogProgress.total} aggregate profiles available · ${catalogProgress.dataAuditCoverageGaps ?? 0} coverage gaps · no new evidence-backed risk`)
        }
        return
      }

      const activeModel = activeAiSource === 'chatgpt'
        ? currentChatGPT.selectedModel ?? 'ChatGPT'
        : currentAiStatus.providers[activeAiSource].model
      setActivity(`${activeModel} is analyzing the graph and previous versions…`)
      const [runtimeDiagnostics, proposalMemory] = await Promise.all([
        window.dataLab.exportDiagnostics()
          .then((bundle) => bundle.events
            .filter((event) => event.status === 'warning' || event.status === 'error')
            .slice(-16)
            .map(({ action, category, status, timestamp }) => ({ action, category, status, timestamp })))
          .catch(() => []),
        window.dataLab.listAgentProposalMemory(),
      ])
      const requestPayload = buildPipelineAgentRequest({
        autonomyPolicy,
        datahubEvidence,
        edges,
        incidentContext: incidentSummaries,
        issues,
        nodes: executionNodes,
        objective: agentRequest,
        proposalMemory,
        responseLanguage: language === 'fr' ? 'French' : 'English',
        runtimeDiagnostics,
        sourceScope: {
          mode: sourceSelection.mode,
          sourceIds: routedSources.map((source) => source.id),
          sourceUrns: routedSources.flatMap((source) => source.data.datahubUrn ? [source.data.datahubUrn] : []),
        },
        versions,
      })
      const response = activeAiSource === 'chatgpt'
        ? await window.dataLab.runChatGPTProposal(requestPayload)
        : await window.dataLab.runAiProposal(requestPayload)
      if (agentRunId.current !== runId) return
      const providerConnectivityKey = `connectivity:provider:${activeAiSource}`
      if (incidentSummaries.some((incident) => incident.incidentKey === providerConnectivityKey && incident.status !== 'resolved')) {
        await logIncident({
          incidentKey: providerConnectivityKey,
          transition: 'recovered',
          severity: 'info',
          title: `${active.label} connection restored`,
          detail: `${active.label} answered a bounded agent request successfully.`,
          sourceSystem: 'SAM LAB connectivity',
          fingerprint: 'connectivity:recovered',
        })
      }
      recordDiagnostic({
        category: 'provider',
        action: 'pipeline.proposal',
        status: 'success',
        detail: { source: activeAiSource, model: response.model, evidenceCount: evidenceEntries.length },
      })
      const nextProposal = materializeAiProposal(response, executionNodes, edges)
      if (catalogExplorer && catalogProgress) catalog.attachProgress(nextProposal, catalogExplorer, catalogProgress)
      nextProposal.incidentKey = monitored?.incidentKey
      if (blankCandidate) {
        const proposedSource = nextProposal.addedNodes.find((node) => node.data.kind === 'source')
        if (proposedSource) proposedSource.data = {
          ...proposedSource.data,
          label: blankCandidate.name,
          description: blankCandidate.description || proposedSource.data.description,
          owner: blankCandidate.owners.join(', ') || proposedSource.data.owner,
          schema: blankCandidate.fields,
          connectorId: blankCandidate.connectorId ?? 'datahub',
          sourceSystem: blankCandidate.sourceSystem ?? 'DataHub',
          assetRef: blankCandidate.assetRef ?? blankCandidate.urn,
          datahubUrn: (blankCandidate.connectorId ?? 'datahub') === 'datahub' ? blankCandidate.urn : undefined,
          datahubPlatform: blankCandidate.platform,
          datahubEnvironment: blankCandidate.environment,
          datahubDomain: blankCandidate.domain,
          datahubTags: blankCandidate.tags,
          datahubQuality: blankCandidate.qualityStatus,
          datahubFreshness: blankCandidate.freshness,
          datahubUpstream: blankCandidate.upstream,
          datahubDownstream: blankCandidate.downstream,
        }
        if (unboundSource) {
          nextProposal.addedNodes = []
          nextProposal.updatedNodes = [{
            nodeId: unboundSource.id,
            reason: 'Bind the existing placeholder to the governed DataHub asset discovered from fresh MCP evidence.',
            patch: {
              label: blankCandidate.name,
              description: blankCandidate.description || 'Governed DataHub source selected by the autonomous player.',
              owner: blankCandidate.owners.join(', ') || 'Unassigned',
              schema: blankCandidate.fields,
              connectorId: blankCandidate.connectorId ?? 'datahub',
              sourceSystem: blankCandidate.sourceSystem ?? 'DataHub',
              assetRef: blankCandidate.assetRef ?? blankCandidate.urn,
              datahubUrn: (blankCandidate.connectorId ?? 'datahub') === 'datahub' ? blankCandidate.urn : undefined,
              datahubPlatform: blankCandidate.platform,
              datahubEnvironment: blankCandidate.environment,
              datahubDomain: blankCandidate.domain,
              datahubTags: blankCandidate.tags,
              datahubQuality: blankCandidate.qualityStatus,
              datahubFreshness: blankCandidate.freshness,
              datahubUpstream: blankCandidate.upstream,
              datahubDownstream: blankCandidate.downstream,
            },
          }]
          nextProposal.addedEdges = nextProposal.addedEdges.filter((edge) => edge.source !== unboundSource.id && edge.target !== unboundSource.id)
          nextProposal.removedEdgeIds = []
          nextProposal.title = `Bind ${blankCandidate.name}`
          nextProposal.summary = `Bind the existing Data Source to ${blankCandidate.urn} from fresh DataHub MCP evidence, then reread the graph before adding the next incident-handling card.`
          nextProposal.requiresHumanReview = false
          nextProposal.incidentKey = 'source-discovery:datahub'
          await logIncident({
            incidentKey: 'source-discovery:datahub',
            transition: 'recovered',
            severity: 'info',
            title: `Governed source discovered · ${blankCandidate.name}`,
            detail: `Fresh DataHub evidence resolved the unbound source to ${blankCandidate.urn}.`,
            sourceSystem: 'DataHub',
            sourceRef: blankCandidate.urn,
            fingerprint: blankCandidate.urn,
            cardId: unboundSource.id,
            branchId: unboundSource.id,
          })
        }
      }
      for (const [sourceUrn, profileCandidate] of profileCandidates) {
        const sourceNode = nodes.find((node) => node.data.kind === 'source' && (node.data.assetRef ?? node.data.datahubUrn) === sourceUrn)
          ?? nextProposal.addedNodes.find((node) => node.data.kind === 'source' && (node.data.assetRef ?? node.data.datahubUrn) === sourceUrn)
        addDataProfileToProposal(nextProposal, nodes, profileCandidate, sourceNode)
      }
      const initialMaterialChangeCount = nextProposal.addedNodes.length
        + nextProposal.updatedNodes.length
        + nextProposal.addedEdges.length
        + nextProposal.removedEdgeIds.length
      const riskAssets = new Map(riskAssetsFromGraph([...nodes, ...nextProposal.addedNodes]).map((asset) => [asset.urn, asset]))
      for (const asset of profileCandidates.values()) riskAssets.set(asset.urn, asset)
      const hostRisk = evaluateHostRisk([...riskAssets.values()], evidenceEntries, autonomyPolicy)
      const retryExhausted = monitored?.reason === 'retry-exhausted'
      const frequentReview = policyForcesProposalReview(autonomyPolicy, initialMaterialChangeCount)
      if (retryExhausted || (initialMaterialChangeCount > 0 && (hostRisk.requiresHumanReview || frequentReview))) {
        const reason = retryExhausted
          ? `Retry budget exhausted for ${monitored.monitor.monitorLabel} after ${monitored.attempts - 1}/${monitored.monitor.policy.maxIterations} autonomous repair attempts. The incident remains open and this branch now requires an explicit decision.`
          : frequentReview
            ? 'The configured Frequent policy requires explicit approval for every material graph diff.'
            : `${hostRisk.severity.toUpperCase()} host risk score ${hostRisk.score}: ${hostRisk.reasons.join(' ')}`
        ensureHostReviewCheckpoint(nextProposal, nodes, edges, {
          anchorId: monitored?.monitor.monitorId ?? routedSources[0]?.id ?? nextProposal.addedNodes.find((node) => node.data.kind === 'source')?.id,
          reason,
          risk: hostRisk,
        })
      }
      // The risk gate can add a new terminal review outcome. Run deterministic
      // sensitive-path repair after that insertion so the approved route is
      // Human Review -> versioned protection -> Output, matching the incident
      // loop instead of creating a new unprotected sink.
      const safetyRepair = repairSensitiveOutputPaths(nextProposal, nodes, edges)
      if (safetyRepair.repairedOutputs.length) recordDiagnostic({
        category: 'revision',
        action: 'proposal.host-safety-repair',
        status: 'warning',
        detail: {
          repairedOutputs: safetyRepair.repairedOutputs,
          reason: 'sensitive-output-protection',
        },
      })
      const monitorRepair = repairMonitorWorkBranches(nextProposal, nodes, edges)
      if (monitorRepair.repairedMonitors.length) recordDiagnostic({
        category: 'revision',
        action: 'proposal.monitor-work-repair',
        status: 'warning',
        detail: {
          repairedMonitors: monitorRepair.repairedMonitors,
          reason: 'missing-bounded-iteration-target',
        },
      })
      nextProposal.runTrace = buildAtomicRunTrace(nodes, atomicRun)
      const preview = applyProposal(executionNodes, edges, nextProposal)
      const proposalGraphFingerprint = graphFingerprint(preview.nodes, preview.edges)
      const rememberedProposal = await window.dataLab.rememberAgentProposal({
        graphFingerprint: proposalGraphFingerprint,
        baseGraphFingerprint: graphFingerprint(executionNodes, edges),
        source: 'pipeline',
        title: nextProposal.title,
        summary: nextProposal.summary,
        rationale: nextProposal.rationale,
      })
      if (rememberedProposal.occurrenceCount > 1) {
        atomicRepairState.current = undefined
        setActivity(`Repeated graph blocked by SQLite memory · "${rememberedProposal.title}" was already attempted ${rememberedProposal.occurrenceCount - 1} time${rememberedProposal.occurrenceCount === 2 ? '' : 's'} · graph unchanged`)
        recordDiagnostic({
          category: 'revision',
          action: 'proposal.duplicate-memory',
          status: 'warning',
          detail: { graphFingerprint: proposalGraphFingerprint, occurrenceCount: rememberedProposal.occurrenceCount, priorStatus: rememberedProposal.status },
        })
        return
      }
      const equivalentVersion = findEquivalentVersion(preview.nodes, preview.edges, versions)
      if (graphsEquivalent(executionNodes, edges, preview.nodes, preview.edges) || equivalentVersion) {
        await window.dataLab.updateAgentProposalMemoryStatus(proposalGraphFingerprint, 'duplicate', equivalentVersion?.id).catch(() => undefined)
        atomicRepairState.current = undefined
        const autonomousSessionActive = expectedPlayerSessionId !== undefined && playerSessionId.current === expectedPlayerSessionId
        const hasMonitor = nodes.some((node) => node.data.kind === 'monitor')
        if (autonomousSessionActive && !hasMonitor && !monitorBootstrapAttempted.current) {
          monitorBootstrapAttempted.current = true
          setActivity('Graph is already current · no duplicate revision created · preparing the missing Live Monitor…')
          queueAutonomousStep('The previous proposal is already committed. Do not repeat it. Propose the next coherent missing iteration toward continuous incident handling; if the governed path is otherwise complete, add the required Live Monitor and feedback boundary.', expectedPlayerSessionId)
        } else if (
          autonomousSessionActive
          && pendingCatalogRiskUrn
          && !catalogAdvanceAttempted.current.has(pendingCatalogRiskUrn)
        ) {
          catalogAdvanceAttempted.current.add(pendingCatalogRiskUrn)
          setActivity('Catalog risk branch was not materialized · one focused correction scheduled…')
          queueAutonomousStep(
            `The previous proposal duplicated the current graph while the terminal catalog still contains an unrepresented risk candidate. Do not repeat or rewrite the existing branch. Build exactly one new evidence-backed branch for ${pendingCatalogRiskUrn}, connect its Source, Data Profile, Impact Analysis, Risk Assessment and required review/protection/output path, then leave the other catalog datasets for later iterations.`,
            expectedPlayerSessionId,
            1_200,
          )
        } else {
          setActivity(hasMonitor
            ? 'Graph is already current · no duplicate revision created · Live Monitor remains armed'
            : `Graph is already current · no duplicate revision created${autonomousSessionActive ? ' · monitoring needs a Live Monitor card' : ''}`)
        }
        return
      }
      nextProposal.evidence = evidenceEntries
      const materialChangeCount = nextProposal.addedNodes.length
        + nextProposal.updatedNodes.length
        + nextProposal.addedEdges.length
        + nextProposal.removedEdgeIds.length
      if (policyForcesProposalReview(autonomyPolicy, materialChangeCount)) nextProposal.requiresHumanReview = true
      const autonomousSessionActive = expectedPlayerSessionId !== undefined && playerSessionId.current === expectedPlayerSessionId
      const touchesReviewCheckpoint = nextProposal.addedNodes.some((node) => node.data.kind === 'review')
        || nextProposal.updatedNodes.some((update) => nodes.find((node) => node.id === update.nodeId)?.data.kind === 'review')
      if (touchesReviewCheckpoint) nextProposal.requiresHumanReview = true
      if ((monitored || autonomousSessionActive) && !nextProposal.requiresHumanReview && !touchesReviewCheckpoint) {
        const autonomousVersionId = commitAutonomousProposal(nextProposal, {
          executionNodes,
          preservePendingReview: independentBranchDuringReview,
        })
        if (autonomousVersionId && projectTitle === 'Untitled pipeline') setProjectTitle(nextProposal.title.slice(0, 72))
        if (autonomousVersionId) {
          if (nextProposal.addedNodes.length > 0) fitCommittedGraph([
            ...nextProposal.addedNodes.map((node) => node.id),
            ...nextProposal.updatedNodes.map((node) => node.nodeId),
            ...nextProposal.addedEdges.flatMap((edge) => [edge.source, edge.target]),
          ])
          await window.dataLab.updateAgentProposalMemoryStatus(proposalGraphFingerprint, 'committed', autonomousVersionId).catch(() => undefined)
          atomicRepairState.current = undefined
          if (monitored) {
            correctionVerifications.current.set(liveMonitorBindingKey(monitored.monitor), {
              incidentKey: monitored.incidentKey,
              versionId: autonomousVersionId,
              baselineFingerprint: monitored.observation.fingerprint,
              registeredAt: new Date().toISOString(),
            })
            await logIncident({
              incidentKey: monitored.incidentKey,
              transition: 'agent-action',
              severity: 'info',
              title: nextProposal.title,
              detail: `${nextProposal.summary} The correction passed atomic validation and was committed as a restorable version. An explicit fresh-evidence verification is now required before the incident can resolve.`,
              sourceSystem: 'DataHub',
              sourceRef: monitored.monitor.urn,
              fingerprint: monitored.audit.reads.map((read) => `${read.name}:${read.status}:${read.stale}`).join('|'),
              cardId: monitored.monitor.monitorId,
              branchId: monitored.monitor.monitorId,
              versionId: autonomousVersionId,
            })
          } else {
            queueAutonomousStep(`Iteration "${nextProposal.title}" is committed. Reread the current graph, reports, diagnostics and version memory, then propose the next coherent useful iteration toward a self-monitoring incident workflow. Return no action when the graph is complete.`, expectedPlayerSessionId)
          }
        } else if (autonomousSessionActive) {
          await window.dataLab.updateAgentProposalMemoryStatus(proposalGraphFingerprint, 'invalid').catch(() => undefined)
          const blockers = atomicTransactionBlockers(validatePipeline(preview.nodes, preview.edges))
          const repair = planAtomicRepair(atomicRepairState.current, expectedPlayerSessionId, blockers.map((issue) => issue.id))
          atomicRepairState.current = repair.nextState
          if (repair.shouldRetry) {
            const feedback = blockers.map((issue) => `${issue.id} · ${issue.title}: ${issue.detail}`).join(' | ')
            queueAutonomousStep(`The previous graph diff was rejected atomically and was not committed. This is the single bounded repair turn. Repair the proposal itself in one smaller coherent diff. Resolve these exact blockers without weakening validation or duplicating cards: ${feedback}`, expectedPlayerSessionId, 1_200)
            setActivity(`Autonomous correction rejected safely · ${blockers.length} atomic check${blockers.length === 1 ? '' : 's'} failed · bounded repair 1/${maximumAtomicRepairAttempts} scheduled`)
            recordDiagnostic({
              category: 'revision',
              action: 'proposal.atomic-repair',
              status: 'warning',
              detail: { blockerIds: blockers.map((issue) => issue.id), attempt: repair.nextState.attempts, maximumAttempts: maximumAtomicRepairAttempts },
            })
          } else {
            setActivity(`Atomic repair stopped safely · ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} remain · waiting for a new event or Human Review`)
            notifyToast('The graph stayed unchanged. SAM LAB exhausted the bounded repair turn and will not hot-loop on the same invalid diff.', 'error', 'Atomic repair stopped')
            recordDiagnostic({
              category: 'revision',
              action: 'proposal.atomic-repair.exhausted',
              status: 'error',
              detail: { blockerIds: blockers.map((issue) => issue.id), blockerFingerprint: repair.blockerFingerprint, maximumAttempts: maximumAtomicRepairAttempts },
            })
          }
        }
        return
      }
      if (independentBranchDuringReview) {
        setDeferredReviewTriggers((current) => current.some((trigger) => trigger.incidentKey === monitored!.incidentKey)
          ? current
          : [...current, monitored!])
        setActivity(`Independent branch ${monitored!.monitor.sourceLabel} requires Human Review · current review preserved · branch queued`)
        return
      }
      atomicRepairState.current = undefined
      resumePlayerAfterReview.current = playerState === 'running' && expectedPlayerSessionId !== undefined
      setProposal(nextProposal)
      setReviewBlockedBranchId(monitored?.monitor.monitorId)
      setProposalReviewOpen(true)
      const reviewVersionId = recordPendingReview(nextProposal)
      await window.dataLab.updateAgentProposalMemoryStatus(proposalGraphFingerprint, 'pending-review', reviewVersionId).catch(() => undefined)
      setActivity(`${response.model} proposed ${materialChangeCount} reviewed change(s) · graph unchanged`)
      if (nextProposal.requiresHumanReview) {
        if (nextProposal.incidentKey) void logIncident({
          incidentKey: nextProposal.incidentKey,
          transition: 'human-review',
          severity: 'warning',
          title: nextProposal.title,
          detail: nextProposal.summary,
          sourceSystem: monitored ? 'DataHub' : undefined,
          sourceRef: monitored?.monitor.urn,
          versionId: reviewVersionId,
          branchId: monitored?.monitor.monitorId,
        })
        void window.dataLab.notifyHumanReview({
          cardLabel: 'Agent Decision',
          reason: nextProposal.summary,
          versionId: reviewVersionId,
        })
      }
    } catch (error) {
      if (agentRunId.current !== runId) return
      notifyError(error, 'Agent run failed')
      recordDiagnostic({
        category: 'provider',
        action: 'pipeline.proposal',
        status: 'error',
        detail: { source: activeAiSource, message: errorMessage(error) },
      })
      const connectivity = classifyConnectivityFailure(error, active.label)
      if (connectivity) await logIncident({
        incidentKey: `connectivity:provider:${activeAiSource}`,
        transition: incidentSummaries.some((incident) => incident.incidentKey === `connectivity:provider:${activeAiSource}` && incident.status !== 'resolved')
          ? 'worsened'
          : 'opened',
        severity: connectivity.kind === 'authentication' ? 'warning' : 'critical',
        title: connectivity.title,
        detail: connectivity.detail,
        sourceSystem: connectivity.sourceSystem,
        fingerprint: connectivity.fingerprint,
      })
      setActivity(`Agent run failed · ${errorMessage(error, 'Unknown provider error')} · graph unchanged`)
    } finally {
      if (agentRunId.current === runId) setAgentRunning(false)
    }
  }

  useEffect(() => {
    const preservedPrompt = pendingWorkspacePrompt
    if (!preservedPrompt || !workspace.activeWorkspaceId || nodes.length > 0 || versions.length > 0) return
    setPendingWorkspacePrompt(undefined)
    void auditWithAgent(preservedPrompt)
  }, [nodes.length, pendingWorkspacePrompt, versions.length, workspace.activeWorkspaceId])

  useEffect(() => {
    if (!proposal) setReviewBlockedBranchId(undefined)
  }, [proposal])

  useEffect(() => {
    if (
      playerState !== 'running'
      || proposal
      || agentRunning
      || playerStarting
      || autonomousStepRequest
      || autonomousStepScheduled
      || reviewRepairPending.current
      || deferredReviewTriggers.length === 0
    ) return
    const [trigger, ...remaining] = deferredReviewTriggers
    setDeferredReviewTriggers(remaining)
    void auditWithAgent(
      `Resume the queued independent incident branch for ${trigger.monitor.sourceLabel}. Reuse its preserved evidence, change only that branch, and keep every unrelated branch running.`,
      trigger,
    )
  }, [
    agentRunning,
    autonomousStepRequest,
    autonomousStepScheduled,
    deferredReviewTriggers,
    playerStarting,
    playerState,
    proposal,
  ])

  useEffect(() => {
    if (!autonomousStepRequest) return
    if (
      autonomousStepRequest.sessionId !== playerSessionId.current
      || autonomousStepRequest.stepId !== autonomousStepId.current
    ) {
      const staleStepId = autonomousStepRequest.stepId
      setAutonomousStepRequest(undefined)
      if (autonomousStepId.current === staleStepId) setAutonomousStepScheduled(false)
      return
    }
    if (playerState !== 'running' || proposal || agentRunning || playerStarting) return
    const request = autonomousStepRequest
    setAutonomousStepRequest(undefined)
    void auditWithAgent(request.objective, undefined, request.sessionId).finally(() => {
      if (autonomousStepId.current === request.stepId) setAutonomousStepScheduled(false)
    })
  }, [agentRunning, autonomousStepRequest, playerStarting, playerState, proposal])

  useEffect(() => () => {
    if (autonomousStepTimer.current !== undefined) window.clearTimeout(autonomousStepTimer.current)
  }, [])

  const playAgent = () => {
    if (agentRunning || playerStarting || reviewAssistant.busy || proposal) return
    if (!active.connected) {
      setSettingsSection('ai')
      setSettingsOpen(true)
      setActivity(`${active.label} is not connected · autonomous player remains stopped`)
      return
    }
    if (playerState === 'stopped') catalog.resetRetriesOnNextExplore()
    const sessionId = ++playerSessionId.current
    autonomousSchedulingBlocked.current = false
    atomicRepairState.current = undefined
    monitorBootstrapAttempted.current = false
    catalogAdvanceAttempted.current.clear()
    setAutonomousStepRequest(undefined)
    setAutonomousStepScheduled(false)
    playerStartupBlocked.current = true
    setPlayerStarting(true)
    setPlayerState('running')
    const systemCards = ensureAutonomousSystemCards(nodes)
    const controller = systemCards.controller
    if (systemCards.added.length) {
      setNodes((current) => [...current, ...systemCards.added])
      setActivity(`${systemCards.added.map((node) => node.data.label).join(' and ')} created · preparing complete catalog exploration…`)
      playerStartupBlocked.current = false
      setPlayerStarting(false)
      // Schedule the first audit on the next turn so the hook observes the
      // newly materialized Controller / Worker / Explorer cards. Enqueuing the
      // request in this same React event can otherwise run against the stale
      // pre-bootstrap graph and leave the catalog idle.
      queueAutonomousStep(
        `Execute the persistent SAM LAB Control policy as coherent versioned iterations: ${controller.data.rule}`,
        sessionId,
        0,
      )
      return
    }
    const objective = controller?.data.rule?.trim()
      ? `Execute the persistent SAM LAB Control policy exactly and incrementally: ${controller.data.rule}`
      : defaultBlankObjective
    setActivity(controller
      ? `Autonomous player started · following ${controller.data.label}…`
      : nodes.length
        ? 'Autonomous player started · auditing the current graph before monitoring changes…'
        : 'Autonomous player started · discovering the best governed starting point…')
    void auditWithAgent(objective, undefined, sessionId).finally(() => {
      if (playerSessionId.current === sessionId) {
        playerStartupBlocked.current = false
        setPlayerStarting(false)
      }
    })
  }

  const pauseAgent = () => {
    if (playerState !== 'running') return
    resumePlayerAfterReview.current = false
    autonomousSchedulingBlocked.current = true
    autonomousStepId.current += 1
    setAutonomousStepScheduled(false)
    setAutonomousStepRequest(undefined)
    if (autonomousStepTimer.current !== undefined) {
      window.clearTimeout(autonomousStepTimer.current)
      autonomousStepTimer.current = undefined
    }
    setPlayerState('paused')
    setActivity(agentRunning
      ? 'Autonomous player pause armed · current atomic iteration may finish · no next iteration will start'
      : 'Autonomous player paused · monitoring and new iterations are suspended')
  }

  const stopAgent = () => {
    const cancellingActiveRun = agentRunning
    setPlayerState('stopped')
    autonomousSchedulingBlocked.current = true
    playerSessionId.current += 1
    agentRunId.current += 1
    autonomousStepId.current += 1
    atomicRepairState.current = undefined
    correctionVerifications.current.clear()
    setDeferredReviewTriggers([])
    setReviewBlockedBranchId(undefined)
    setPlayerStarting(false)
    setAutonomousStepScheduled(false)
    setAutonomousStepRequest(undefined)
    if (autonomousStepTimer.current !== undefined) {
      window.clearTimeout(autonomousStepTimer.current)
      autonomousStepTimer.current = undefined
    }
    playerStartupBlocked.current = false
    resumePlayerAfterReview.current = false
    setAgentRunning(false)
    reviewAssistant.stop()
    if (cancellingActiveRun) {
      setNodes((current) => current.map((node) => node.data.runState === 'completed'
        ? node
        : { ...node, data: { ...node.data, runState: 'stopped' } }))
      activeAtomicRun.current = undefined
    }
    setActivity(cancellingActiveRun
      ? 'Emergency stop · current agent run cancelled · active branch unchanged'
      : 'Autonomous player stopped · monitoring disabled · graph unchanged')
    if (window.dataLab) void window.dataLab.cancelAiProposal()
    if (window.dataLab) void window.dataLab.cancelChatGPTProposal()
  }

  const rejectAgentProposal = () => {
    const rejected = proposal
    rejectProposal()
    if (!rejected?.incidentKey) return
    void logIncident({
      incidentKey: rejected.incidentKey,
      transition: 'worsened',
      severity: 'warning',
      title: `${rejected.title} · repair requested`,
      detail: 'Human Review rejected the proposed correction. The affected branch remains unchanged and enters one bounded repair iteration.',
      versionId: pendingVersionId,
    })
    reviewRepairPending.current = true
    window.setTimeout(() => {
      if (playerState === 'running' && !agentRunning) {
        void auditWithAgent(`Repair the rejected incident proposal "${rejected.title}". Preserve the reviewer rejection in version memory, change only the affected branch, and do not repeat the rejected diff.`)
          .finally(() => { reviewRepairPending.current = false })
      } else {
        reviewRepairPending.current = false
      }
    }, 250)
  }

  useLiveIncidentMonitor({
    active: Boolean(window.dataLab) && connectionMode === 'connected' && playerState === 'running',
    agentBusy: agentRunning || playerStarting || Boolean(autonomousStepRequest),
    reviewBlockedBranchId,
    nodes,
    edges,
    verificationRequests: correctionVerifications,
    audit: async (urn) => {
      if (!window.dataLab) throw new Error('Electron is not running')
      return window.dataLab.auditDataHubWithMcp(urn, true)
    },
    onIncident: logIncident,
    onTrigger: async (trigger) => {
      if (playerStartupBlocked.current) return
      const risk = monitorHostRisk(trigger, autonomyPolicy)
      if (proposal && reviewBlockedBranchId !== trigger.monitor.monitorId && risk.requiresHumanReview) {
        setDeferredReviewTriggers((current) => current.some((candidate) => candidate.incidentKey === trigger.incidentKey)
          ? current
          : [...current, trigger])
        await logIncident({
          incidentKey: trigger.incidentKey,
          transition: 'human-review',
          severity: trigger.observation.severity,
          title: `${trigger.monitor.monitorLabel} · independent branch queued`,
          detail: `${risk.severity.toUpperCase()} evidence-backed host risk requires review. The active Human Review remains isolated; this branch was queued without stopping monitoring.`,
          sourceSystem: 'DataHub',
          sourceRef: trigger.monitor.urn,
          fingerprint: trigger.observation.fingerprint,
          cardId: trigger.monitor.monitorId,
          branchId: trigger.monitor.monitorId,
        })
        return
      }
      await auditWithAgent(
        trigger.reason === 'retry-exhausted'
          ? `Live Monitor exhausted ${trigger.monitor.policy.maxIterations} autonomous repair attempts for ${trigger.monitor.sourceLabel}. Preserve the incident and source provenance, add or update a branch-local Human Review checkpoint, and do not apply another autonomous correction until a person decides.`
          : trigger.reason === 'verification-failed'
            ? `The explicit post-correction verification failed for ${trigger.monitor.sourceLabel}. Fresh evidence still reports the incident. Reuse the verified blocker, update only this branch, and propose the next bounded repair without repeating the previous version.`
          : `Live Monitor detected a connector metadata change for ${trigger.monitor.sourceLabel}. Investigate the incident, preserve its source provenance, update only the affected branch, and propose one coherent versioned correction.`,
        trigger,
      )
    },
  })

  const approveAgentProposal = async (writebackRequested: boolean) => {
    if (proposalApprovalRunning.current) return false
    proposalApprovalRunning.current = true
    setProposalApprovalBusy(true)
    try {
      const currentProposal = proposal
      const revisionId = pendingVersionId
      const relatedAssets = [...new Set(nodes.flatMap((node) => node.data.datahubUrn ? [node.data.datahubUrn] : []))]
      if (!currentProposal) {
        notifyToast('The reviewed proposal is no longer pending. The graph was not changed.', 'error', 'Approval unavailable')
        return false
      }
      const preview = applyProposal(nodes, edges, currentProposal)
      const approvalBlockers = atomicTransactionBlockers(validatePipeline(preview.nodes, preview.edges))
      if (approvalBlockers.length) {
        await window.dataLab?.updateAgentProposalMemoryStatus(graphFingerprint(preview.nodes, preview.edges), 'invalid', revisionId).catch(() => undefined)
        const feedback = approvalBlockers.map((issue) => `${issue.id} · ${issue.title}: ${issue.detail}`).join(' | ')
        const repair = planAtomicRepair(atomicRepairState.current, playerSessionId.current, approvalBlockers.map((issue) => issue.id))
        atomicRepairState.current = repair.nextState
        discardInvalidProposal(approvalBlockers.map((issue) => issue.id))
        setProposalReviewOpen(false)
        resumePlayerAfterReview.current = false
        setPlayerState('running')
        if (repair.shouldRetry) {
          autonomousSchedulingBlocked.current = false
          queueAutonomousStep(`The human approved the intent of "${currentProposal.title}", but SAM LAB rejected its implementation atomically. This is the single bounded repair turn. Preserve that human approval as intent, discard the invalid diff, and produce a smaller corrected proposal that resolves every blocker without weakening validation: ${feedback}`, playerSessionId.current, 200)
          notifyToast('Your approval was preserved as intent. The invalid diff was discarded and the agent gets one bounded repair turn.', 'info', 'Agent repair started')
        } else {
          setActivity(`Human intent preserved · atomic repair budget exhausted · ${approvalBlockers.length} blocker${approvalBlockers.length === 1 ? '' : 's'} remain · graph unchanged`)
          notifyToast('The invalid diff was discarded. SAM LAB will wait for a new event or a new Human Review instead of retrying forever.', 'error', 'Atomic repair stopped')
        }
        return true
      }
      if (!approveProposal()) return false
      await window.dataLab?.updateAgentProposalMemoryStatus(graphFingerprint(preview.nodes, preview.edges), 'committed', revisionId).catch(() => undefined)
      atomicRepairState.current = undefined
      if (currentProposal.incidentKey && revisionId) {
        const incident = incidentSummaries.find((candidate) => candidate.incidentKey === currentProposal.incidentKey)
        const monitor = findBoundLiveMonitors(preview.nodes, preview.edges).find((candidate) => (
          candidate.monitorId === incident?.branchId
          || candidate.urn === incident?.sourceRef
        ))
        if (monitor) {
          correctionVerifications.current.set(liveMonitorBindingKey(monitor), {
            incidentKey: currentProposal.incidentKey,
            versionId: revisionId,
            baselineFingerprint: incident?.fingerprint ?? 'human-reviewed-correction',
            registeredAt: new Date().toISOString(),
          })
        }
      }
      const shouldResumePlayer = playerState === 'running' || resumePlayerAfterReview.current
      const continuePlayer = (objective: string) => {
        if (!shouldResumePlayer) return
        resumePlayerAfterReview.current = false
        autonomousSchedulingBlocked.current = false
        setPlayerState('running')
        if (deferredReviewTriggers.length) {
          setActivity('Human Review approved · queued independent incident branch will resume next')
          return
        }
        queueAutonomousStep(objective, playerSessionId.current)
      }
      if (projectTitle === 'Untitled pipeline') setProjectTitle(currentProposal.title.slice(0, 72))
      if (shouldResumePlayer) setActivity('Human Review approved · player resumed automatically · rereading the committed graph')
      if (currentProposal.incidentKey) void logIncident({
        incidentKey: currentProposal.incidentKey,
        transition: 'agent-action',
        severity: 'info',
        title: currentProposal.title,
        detail: currentProposal.summary,
        versionId: revisionId,
      })
      fitCommittedGraph([
        ...currentProposal.addedNodes.map((node) => node.id),
        ...currentProposal.updatedNodes.map((node) => node.nodeId),
        ...currentProposal.addedEdges.flatMap((edge) => [edge.source, edge.target]),
      ])
      if (!writebackRequested) {
        continuePlayer(`Human Review approved "${currentProposal.title}". Reread the committed graph, reports, diagnostics and version memory, then propose the next coherent safe iteration. Do not repeat the approved diff.`)
        return true
      }
      if (!revisionId) {
        setActivity('Revision committed locally · DataHub write-back skipped because the pending revision ID was unavailable')
        continuePlayer(`Human Review approved "${currentProposal.title}". Reread the committed graph and propose the next coherent safe iteration.`)
        return true
      }
      try {
        setActivity('Revision committed locally · writing the explicitly approved Decision to DataHub…')
        const result = await writeDataHubDecision({
          revisionId,
          title: currentProposal.title,
          rationale: currentProposal.rationale,
          author: 'SAM LAB operator',
          relatedAssets,
        })
        setActivity(`Revision committed locally · DataHub write-back succeeded · ${result.summary}`)
      } catch (error) {
        notifyError(error, 'DataHub write-back failed')
        setActivity(`Revision committed locally · DataHub write-back failed · ${errorMessage(error)} · local graph was not rolled back`)
      }
      continuePlayer(`Human Review approved "${currentProposal.title}". Reread the committed graph, reports, diagnostics and version memory, then propose the next coherent safe iteration.`)
      return true
    } catch (error) {
      notifyError(error, 'Unable to apply the reviewed graph')
      setActivity(`Approval failed · ${errorMessage(error, 'Unexpected graph transaction error')} · graph unchanged`)
      recordDiagnostic({
        category: 'revision',
        action: 'proposal.approve',
        status: 'error',
        detail: { message: errorMessage(error) },
      })
      return false
    } finally {
      proposalApprovalRunning.current = false
      setProposalApprovalBusy(false)
    }
  }

  return {
    agentRunning,
    approveAgentProposal,
    auditWithAgent,
    pauseAgent,
    playAgent,
    playerSessionId,
    playerStarting,
    playerState,
    proposalApprovalBusy,
    queueAutonomousStep,
    rejectAgentProposal,
    setAgentRunning,
    stepPending: autonomousStepScheduled || Boolean(autonomousStepRequest),
    stopAgent,
  }
}
