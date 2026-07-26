import type { Edge } from '@xyflow/react'
import { canConnectCardKinds } from '../domain/card-compatibility'
import { applyProposal, type AgentProposal, type PipelineNode } from '../domain/pipeline'
import { atomicTransactionBlockers, validatePipeline } from '.'

function uniqueId(base: string, used: Set<string>) {
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}-${suffix++}`
  used.add(candidate)
  return candidate
}

function reachableFrom(startId: string, targetId: string, nodes: PipelineNode[], edges: Edge[]) {
  const known = new Set(nodes.map((node) => node.id))
  const queue = [startId]
  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (current === targetId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) if (edge.source === current && edge.sourceHandle !== 'feedback' && known.has(edge.target)) {
      queue.push(edge.target)
    }
  }
  return false
}

function appendMitigationEvidence(proposal: AgentProposal, currentNodes: PipelineNode[], riskId: string) {
  const added = proposal.addedNodes.find((node) => node.id === riskId)
  const current = added ?? currentNodes.find((node) => node.id === riskId)
  if (!current) return
  const mitigation = 'mitigation=versioned_sensitive_field_protection | residual_risk=verify_post_condition'
  const description = current.data.description.includes('Versioned mitigation diff:')
    ? current.data.description
    : `${current.data.description} Versioned mitigation diff: mask or tokenize classified sensitive fields before the reviewed Output; retain the original risk and verify the post-condition on fresh evidence.`
  const rule = current.data.rule?.includes('mitigation=versioned_sensitive_field_protection')
    ? current.data.rule
    : `${current.data.rule ?? ''} | ${mitigation}`.replace(/^\s*\|\s*/, '')
  if (added) {
    added.data = { ...added.data, description, rule }
    return
  }
  const update = proposal.updatedNodes.find((candidate) => candidate.nodeId === riskId)
  if (update) {
    update.patch = { ...update.patch, description, rule }
    return
  }
  proposal.updatedNodes.push({
    nodeId: riskId,
    reason: 'Record the versioned sensitive-data mitigation diff without erasing the original risk.',
    patch: { description, rule },
  })
}

/**
 * Repairs one class of deterministic safety blocker before a proposal reaches
 * Human Review. The model still chooses the branch and output; the host only
 * inserts the mandatory protection boundary that its own validator requires.
 */
export function repairSensitiveOutputPaths(
  proposal: AgentProposal,
  currentNodes: PipelineNode[],
  currentEdges: Edge[],
): { repairedOutputs: string[] } {
  const preview = applyProposal(currentNodes, currentEdges, proposal)
  const sensitiveOutputIds = [...new Set(atomicTransactionBlockers(validatePipeline(preview.nodes, preview.edges))
    .filter((finding) => finding.id.startsWith('sensitive-unprotected-') && finding.nodeId)
    .map((finding) => finding.nodeId!))]
  if (!sensitiveOutputIds.length) return { repairedOutputs: [] }

  const nodeIds = new Set(preview.nodes.map((node) => node.id))
  const edgeIds = new Set(preview.edges.map((edge) => edge.id))
  const currentEdgeIds = new Set(currentEdges.map((edge) => edge.id))
  const repairedOutputs: string[] = []

  for (const outputId of sensitiveOutputIds) {
    const incoming = preview.edges.filter((edge) => edge.target === outputId && edge.sourceHandle !== 'feedback')
    if (!incoming.length) continue
    const output = preview.nodes.find((node) => node.id === outputId)
    const transformId = uniqueId(`protect-${outputId}`, nodeIds)
    proposal.addedNodes.push({
      id: transformId,
      type: 'pipeline',
      position: {
        x: Math.max(0, (output?.position.x ?? 400) - 285),
        y: output?.position.y ?? 120,
      },
      data: {
        kind: 'transform',
        label: `Protect sensitive fields for ${output?.data.label ?? 'output'}`,
        description: 'Host-required graph boundary that masks, hashes or tokenizes fields classified as sensitive before this output.',
        owner: 'SAM LAB Agent',
        rule: 'mask_or_tokenize(classified_sensitive_fields) | source_mutation=none | graph_only=true',
        status: 'draft',
        schema: [],
        agentAdded: true,
      },
    })

    const incomingIds = new Set(incoming.map((edge) => edge.id))
    proposal.addedEdges = proposal.addedEdges.filter((edge) => !incomingIds.has(edge.id))
    for (const edge of incoming) {
      if (currentEdgeIds.has(edge.id) && !proposal.removedEdgeIds.includes(edge.id)) proposal.removedEdgeIds.push(edge.id)
      proposal.addedEdges.push({
        id: uniqueId(`e-${edge.source}-${transformId}`, edgeIds),
        source: edge.source,
        target: transformId,
        sourceHandle: edge.sourceHandle,
        type: 'elastic',
      })
    }
    proposal.addedEdges.push({
      id: uniqueId(`e-${transformId}-${outputId}`, edgeIds),
      source: transformId,
      target: outputId,
      type: 'elastic',
    })
    for (const risk of preview.nodes.filter((node) => (
      node.data.kind === 'risk'
      && reachableFrom(node.id, outputId, preview.nodes, preview.edges)
    ))) appendMitigationEvidence(proposal, currentNodes, risk.id)
    repairedOutputs.push(outputId)
  }

  if (repairedOutputs.length) {
    proposal.requiresHumanReview = true
    proposal.summary = `${proposal.summary} SAM LAB inserted ${repairedOutputs.length} mandatory sensitive-data protection boundary${repairedOutputs.length === 1 ? '' : 'ies'} required by atomic validation.`
    proposal.rationale = `${proposal.rationale} The host refused a direct sensitive source-to-output path and repaired the proposed diff without mutating source data.`
  }
  return { repairedOutputs }
}

/**
 * A feedback edge arms a Live Monitor, but the monitor must also identify the
 * first replayable card of the next bounded iteration. Provider proposals
 * occasionally omit that second edge. Repair it from the already versioned
 * branch instead of spending another model turn or leaving an orphan monitor.
 */
export function repairMonitorWorkBranches(
  proposal: AgentProposal,
  currentNodes: PipelineNode[],
  currentEdges: Edge[],
): { repairedMonitors: string[] } {
  const preview = applyProposal(currentNodes, currentEdges, proposal)
  const edgeIds = new Set(preview.edges.map((edge) => edge.id))
  const priority = new Map([
    ['profile', 0],
    ['analysis', 1],
    ['impact', 2],
    ['risk', 3],
    ['query', 4],
    ['validation', 5],
    ['patch', 6],
    ['decision', 7],
    ['transform', 8],
    ['worker', 9],
  ])
  const repairedMonitors: string[] = []

  for (const monitor of preview.nodes.filter((node) => node.data.kind === 'monitor')) {
    if (preview.edges.some((edge) => edge.source === monitor.id && edge.sourceHandle !== 'feedback')) continue
    const feedback = preview.edges.find((edge) => edge.target === monitor.id && edge.sourceHandle === 'feedback')
    if (!feedback) continue

    const distance = new Map<string, number>([[feedback.source, 0]])
    const queue = [feedback.source]
    while (queue.length) {
      const current = queue.shift()!
      const nextDistance = (distance.get(current) ?? 0) + 1
      for (const edge of preview.edges) if (edge.target === current && edge.sourceHandle !== 'feedback' && !distance.has(edge.source)) {
        distance.set(edge.source, nextDistance)
        queue.push(edge.source)
      }
    }
    const candidate = preview.nodes
      .filter((node) => (
        node.id !== monitor.id
        && distance.has(node.id)
        && canConnectCardKinds('monitor', node.data.kind)
      ))
      .sort((left, right) => (
        (priority.get(left.data.kind) ?? 100) - (priority.get(right.data.kind) ?? 100)
        || (distance.get(right.id) ?? 0) - (distance.get(left.id) ?? 0)
      ))[0]
    if (!candidate) continue

    proposal.addedEdges.push({
      id: uniqueId(`e-${monitor.id}-${candidate.id}`, edgeIds),
      source: monitor.id,
      target: candidate.id,
      type: 'elastic',
    })
    repairedMonitors.push(monitor.id)
  }

  if (repairedMonitors.length) {
    proposal.summary = `${proposal.summary} SAM LAB connected ${repairedMonitors.length} Live Monitor${repairedMonitors.length === 1 ? '' : 's'} to the first replayable evidence card of the bounded iteration.`
    proposal.rationale = `${proposal.rationale} The host preserved Output → Live Monitor feedback while preventing an orphan event loop; unchanged fingerprints remain idle.`
  }
  return { repairedMonitors }
}
