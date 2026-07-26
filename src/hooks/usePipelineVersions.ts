import type { Edge } from '@xyflow/react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { connectedLayoutNodeIds, layoutPipeline } from '../domain/layout'
import { applyProposal, loadPipelinePreset, type AgentProposal, type PipelineNode, type PipelinePresetId } from '../domain/pipeline'
import { appendPipelineVersion, commitPendingVersion, createPipelineVersion, graphFingerprint, rejectPendingVersion, restorePipelineVersion, type PipelineVersion } from '../domain/versioning'
import { atomicTransactionBlockers, validatePipeline } from '../validation'
import { recordDiagnostic } from '../domain/diagnostics'
import { notifyToast } from '../domain/toasts'

type PipelineVersionsOptions = {
  edges: Edge[]
  nodes: PipelineNode[]
  proposal?: AgentProposal
  setActivity: (message: string) => void
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setProjectTitle: Dispatch<SetStateAction<string>>
  setProposal: Dispatch<SetStateAction<AgentProposal | undefined>>
  setSelectedId: Dispatch<SetStateAction<string>>
  resolveApprovedExecution?(nodes: PipelineNode[], edges: Edge[]): PipelineNode[]
  resolveRejectedExecution?(nodes: PipelineNode[], edges: Edge[]): PipelineNode[]
}

export function usePipelineVersions({ edges, nodes, proposal, resolveApprovedExecution, resolveRejectedExecution, setActivity, setEdges, setNodes, setProjectTitle, setProposal, setSelectedId }: PipelineVersionsOptions) {
  const [versions, setVersions] = useState<PipelineVersion[]>([])
  const [pendingVersionId, setPendingVersionId] = useState<string>()

  const layoutProposalGraph = (nextNodes: PipelineNode[], nextEdges: Edge[], nextProposal: AgentProposal) => {
    const touched = new Set([
      ...nextProposal.addedNodes.map((node) => node.id),
      ...nextProposal.updatedNodes.map((node) => node.nodeId),
      ...nextProposal.addedEdges.flatMap((edge) => [edge.source, edge.target]),
      ...edges
        .filter((edge) => nextProposal.removedEdgeIds.includes(edge.id))
        .flatMap((edge) => [edge.source, edge.target]),
    ])
    if (touched.size === 0) return nextNodes
    return layoutPipeline(nextNodes, nextEdges, connectedLayoutNodeIds(nextNodes, nextEdges, touched))
  }

  const recordPendingReview = (nextProposal: AgentProposal) => {
    const preview = applyProposal(nodes, edges, nextProposal)
    const previewIssues = validatePipeline(preview.nodes, preview.edges)
    const version = createPipelineVersion(preview.nodes, preview.edges, `Review · ${nextProposal.title}`, 'agent', previewIssues)
    version.blockingIssues = atomicTransactionBlockers(previewIssues).length
    version.status = 'pending-review'
    version.description = `Upgrade: ${nextProposal.summary} Why: ${nextProposal.rationale} Incremental diff: +${nextProposal.addedNodes.length} cards, ~${nextProposal.updatedNodes.length} cards, +${nextProposal.addedEdges.length} edges, -${nextProposal.removedEdgeIds.length} edges.`
    version.evidence = nextProposal.evidence
    setPendingVersionId(version.id)
    setVersions((current) => appendPipelineVersion(current, version))
    return version.id
  }

  const commitAutonomousProposal = (nextProposal: AgentProposal, options: { preservePendingReview?: boolean; executionNodes?: PipelineNode[] } = {}) => {
    // The atomic runner may have advanced cards earlier in the same React
    // turn. Use that in-progress checkpoint instead of the render snapshot so
    // committing a graph diff never erases completed-card cursors.
    const baseNodes = options.executionNodes ?? nodes
    const next = applyProposal(baseNodes, edges, nextProposal)
    const nextIssues = validatePipeline(next.nodes, next.edges)
    const blocking = atomicTransactionBlockers(nextIssues)
    if (blocking.length) {
      setActivity(`Autonomous correction stopped · ${blocking.length} atomic check${blocking.length === 1 ? '' : 's'} failed · graph unchanged`)
      notifyToast(blocking[0]?.detail ?? 'The autonomous correction failed an atomic safety check.', 'error', 'Correction stopped')
      recordDiagnostic({ category: 'revision', action: 'proposal.autonomous', status: 'error', detail: { blockerIds: blocking.map((issue) => issue.id) } })
      return undefined
    }
    const layouted = layoutProposalGraph(next.nodes, next.edges, nextProposal)
    const committedNodes = resolveApprovedExecution?.(layouted, next.edges) ?? layouted
    const version = createPipelineVersion(committedNodes, next.edges, nextProposal.title, 'agent', nextIssues)
    version.blockingIssues = 0
    version.description = `Autonomous incident correction. Upgrade: ${nextProposal.summary} Why: ${nextProposal.rationale} Incremental diff: +${nextProposal.addedNodes.length} cards, ~${nextProposal.updatedNodes.length} cards, +${nextProposal.addedEdges.length} edges, -${nextProposal.removedEdgeIds.length} edges.`
    version.evidence = nextProposal.evidence
    setNodes(committedNodes)
    setEdges(next.edges)
    setVersions((current) => appendPipelineVersion(current, version))
    setSelectedId(nextProposal.updatedNodes[0]?.nodeId ?? nextProposal.addedNodes[0]?.id ?? '')
    if (!options.preservePendingReview) setProposal(undefined)
    setActivity('Low-risk incident correction committed atomically · Live Monitor will verify the next connector fingerprint')
    notifyToast('The low-risk branch was committed as a restorable version. Monitoring remains active while Electron is open.', 'success', 'Incident correction applied')
    recordDiagnostic({ category: 'revision', action: 'proposal.autonomous', status: 'success', detail: { versionId: version.id, incidentKey: nextProposal.incidentKey } })
    return version.id
  }

  const approveProposal = () => {
    if (!proposal) {
      setActivity('Approval unavailable · the proposal is no longer pending · graph unchanged')
      recordDiagnostic({ category: 'revision', action: 'proposal.approve', status: 'warning', detail: { reason: 'proposal-missing' } })
      return false
    }
    const next = applyProposal(nodes, edges, proposal)
    const nextIssues = validatePipeline(next.nodes, next.edges)
    const blocking = atomicTransactionBlockers(nextIssues)
    if (blocking.length) {
      setActivity(`Transaction rejected · ${blocking.length} atomic check${blocking.length === 1 ? '' : 's'} failed · graph unchanged`)
      notifyToast(blocking[0]?.detail ?? 'The proposed graph failed an atomic safety check.', 'error', 'Change not applied')
      recordDiagnostic({
        category: 'revision',
        action: 'proposal.approve',
        status: 'error',
        detail: { blockerIds: blocking.map((issue) => issue.id), blockingIssues: blocking.length },
      })
      return false
    }
    const layouted = layoutProposalGraph(next.nodes, next.edges, proposal)
    const committedNodes = resolveApprovedExecution?.(layouted, next.edges) ?? layouted
    const version = createPipelineVersion(committedNodes, next.edges, proposal.title, 'agent', nextIssues)
    // A safe incremental graph transaction may still have pipeline-readiness
    // findings (for example, no Output card yet). Keep this field scoped to
    // atomic transaction blockers so committed revisions never claim that
    // their atomic validation failed.
    version.blockingIssues = blocking.length
    version.evidence = proposal.evidence
    setNodes(committedNodes)
    setEdges(next.edges)
    setVersions((current) => commitPendingVersion(current, pendingVersionId, version))
    setSelectedId(proposal.updatedNodes[0]?.nodeId ?? proposal.addedNodes[0]?.id ?? '')
    setProposal(undefined)
    setPendingVersionId(undefined)
    const readinessErrors = nextIssues.filter((issue) => issue.severity === 'error').length - blocking.length
    setActivity(readinessErrors > 0
      ? `Change approved · atomic transaction passed · ${readinessErrors} pipeline readiness check${readinessErrors === 1 ? '' : 's'} remain`
      : 'Change approved · atomic checks passed · revision committed')
    notifyToast(`${committedNodes.length} card${committedNodes.length === 1 ? '' : 's'} and ${next.edges.length} connection${next.edges.length === 1 ? '' : 's'} committed to the active graph.`, 'success', 'Graph updated')
    recordDiagnostic({ category: 'revision', action: 'proposal.approve', status: 'success', detail: { versionId: version.id, blockingIssues: 0 } })
    return true
  }

  const rejectProposal = () => {
    const rejectedPreview = proposal ? applyProposal(nodes, edges, proposal) : undefined
    const rejectedFingerprint = rejectedPreview ? graphFingerprint(rejectedPreview.nodes, rejectedPreview.edges) : undefined
    if (pendingVersionId) setVersions((current) => rejectPendingVersion(current, pendingVersionId))
    if (resolveRejectedExecution) setNodes((current) => resolveRejectedExecution(current, edges))
    setPendingVersionId(undefined)
    setProposal(undefined)
    setActivity('Agent proposal rejected · revision marked rejected · active branch unchanged')
    if (rejectedFingerprint && window.dataLab) void window.dataLab.updateAgentProposalMemoryStatus(rejectedFingerprint, 'rejected', pendingVersionId).catch(() => undefined)
    recordDiagnostic({ category: 'revision', action: 'proposal.reject', status: 'info', detail: { versionId: pendingVersionId } })
  }

  const discardInvalidProposal = (blockerIds: string[]) => {
    const invalidPreview = proposal ? applyProposal(nodes, edges, proposal) : undefined
    const invalidFingerprint = invalidPreview ? graphFingerprint(invalidPreview.nodes, invalidPreview.edges) : undefined
    if (pendingVersionId) setVersions((current) => rejectPendingVersion(current, pendingVersionId))
    setPendingVersionId(undefined)
    setProposal(undefined)
    setActivity(`Human intent approved · invalid transaction discarded · agent repairing ${blockerIds.length} atomic blocker${blockerIds.length === 1 ? '' : 's'}`)
    if (invalidFingerprint && window.dataLab) void window.dataLab.updateAgentProposalMemoryStatus(invalidFingerprint, 'invalid', pendingVersionId).catch(() => undefined)
    recordDiagnostic({ category: 'revision', action: 'proposal.atomic-repair', status: 'warning', detail: { versionId: pendingVersionId, blockerIds } })
  }

  const approvePendingVersion = (versionId: string) => {
    const version = versions.find((candidate) => candidate.id === versionId && candidate.status === 'pending-review')
    if (!version) { setActivity('Review is no longer pending · no graph change applied'); return false }
    const versionIssues = validatePipeline(version.nodes, version.edges)
    const blocking = atomicTransactionBlockers(versionIssues)
    if (blocking.length > 0) { setActivity(`Review cannot be approved · ${blocking.length} atomic check${blocking.length === 1 ? '' : 's'} failed`); return false }
    const activeNodeIds = new Set(nodes.map((node) => node.id))
    const addedNodeIds = version.nodes.filter((node) => !activeNodeIds.has(node.id)).map((node) => node.id)
    const layouted = addedNodeIds.length > 0
      ? layoutPipeline(version.nodes, version.edges, connectedLayoutNodeIds(version.nodes, version.edges, addedNodeIds))
      : version.nodes
    const committedNodes = resolveApprovedExecution?.(layouted, version.edges) ?? layouted
    setNodes(committedNodes)
    setEdges(version.edges)
    setVersions((current) => current.map((candidate) => candidate.id === versionId ? { ...candidate, nodes: committedNodes, blockingIssues: 0, status: 'committed' as const } : candidate))
    if (pendingVersionId === versionId) { setPendingVersionId(undefined); setProposal(undefined) }
    setSelectedId(committedNodes[0]?.id ?? '')
    const readinessErrors = versionIssues.filter((issue) => issue.severity === 'error').length - blocking.length
    setActivity(readinessErrors > 0
      ? `Human Review approved · ${version.label} committed · ${readinessErrors} pipeline readiness check${readinessErrors === 1 ? '' : 's'} remain`
      : `Human Review approved · ${version.label} committed atomically`)
    if (window.dataLab) void window.dataLab.updateAgentProposalMemoryStatus(graphFingerprint(version.nodes, version.edges), 'committed', versionId).catch(() => undefined)
    return true
  }

  const rejectPendingVersionById = (versionId: string) => {
    const version = versions.find((candidate) => candidate.id === versionId && candidate.status === 'pending-review')
    if (!version) { setActivity('Review is no longer pending'); return false }
    setVersions((current) => rejectPendingVersion(current, versionId))
    if (resolveRejectedExecution) setNodes((current) => resolveRejectedExecution(current, edges))
    if (pendingVersionId === versionId) { setPendingVersionId(undefined); setProposal(undefined) }
    setActivity(`Human Review rejected · ${version.label} remains visible in history · active graph unchanged`)
    if (window.dataLab) void window.dataLab.updateAgentProposalMemoryStatus(graphFingerprint(version.nodes, version.edges), 'rejected', versionId).catch(() => undefined)
    return true
  }

  const saveManualVersion = () => {
    const currentIssues = validatePipeline(nodes, edges)
    const blocking = currentIssues.filter((issue) => issue.severity === 'error')
    if (blocking.length) {
      setActivity(`Version not saved · fix ${blocking.length} blocking atomic check${blocking.length === 1 ? '' : 's'} first`)
      return
    }
    const version = createPipelineVersion(nodes, edges, `Manual checkpoint ${versions.length + 1}`, 'manual', currentIssues)
    setVersions((current) => appendPipelineVersion(current, version))
    setActivity(`Version saved · ${version.label}`)
    recordDiagnostic({ category: 'revision', action: 'checkpoint.save', status: 'success', detail: { versionId: version.id, label: version.label } })
  }

  const restoreVersion = (versionId: string) => {
    const version = versions.find((candidate) => candidate.id === versionId)
    if (!version || (version.status ?? 'committed') !== 'committed') return
    const restored = restorePipelineVersion(version)
    setNodes(restored.nodes)
    setEdges(restored.edges)
    setProposal(undefined)
    setPendingVersionId(undefined)
    setSelectedId(restored.nodes[0]?.id ?? '')
    setActivity(`Version restored · ${version.label}`)
  }

  const loadPreset = (presetId: PipelinePresetId) => {
    const preset = loadPipelinePreset(presetId)
    setNodes(preset.nodes)
    setEdges(preset.edges)
    setProjectTitle(preset.title)
    setSelectedId(preset.nodes[0]?.id ?? '')
    setProposal(undefined)
    setPendingVersionId(undefined)
    setActivity(presetId === 'empty' ? 'Empty workspace ready' : `${preset.title} example loaded · ${preset.nodes.length} cards · not saved`)
  }

  return { approvePendingVersion, approveProposal, commitAutonomousProposal, discardInvalidProposal, loadPreset, pendingVersionId, recordPendingReview, rejectPendingVersionById, rejectProposal, restoreVersion, saveManualVersion, setVersions, versions }
}
