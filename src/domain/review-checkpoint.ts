import type { Edge } from '@xyflow/react'
import type { AgentProposal, PipelineNode } from './pipeline'
import type { HostRiskDecision } from './risk-gate'
import { riskDomainFromText } from './risk-assessment'

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'proposal'
}

function activeEdges(proposal: AgentProposal, edges: Edge[]) {
  const removed = new Set(proposal.removedEdgeIds)
  return [
    ...edges.filter((edge) => !removed.has(edge.id) && !proposal.addedEdges.some((added) => added.id === edge.id)),
    ...proposal.addedEdges,
  ]
}

function reachableDistances(startId: string | undefined, edges: Edge[]) {
  const distances = new Map<string, number>()
  if (!startId) return distances
  const queue = [{ id: startId, distance: 0 }]
  while (queue.length) {
    const current = queue.shift()!
    if (distances.has(current.id)) continue
    distances.set(current.id, current.distance)
    for (const edge of edges) if (edge.source === current.id && edge.sourceHandle !== 'feedback') {
      queue.push({ id: edge.target, distance: current.distance + 1 })
    }
  }
  return distances
}

function reachesTarget(startId: string, targetId: string, edges: Edge[]) {
  return reachableDistances(startId, edges).has(targetId)
}

function uniqueEdgeId(base: string, edges: Edge[]) {
  const ids = new Set(edges.map((edge) => edge.id))
  let candidate = base
  let suffix = 2
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`
  return candidate
}

function riskRule(decision: HostRiskDecision, scope: string, reason: string) {
  const affectedAssets = decision.riskType === 'data'
    ? Math.max(1, decision.affectedAssets)
    : decision.affectedAssets
  const domain = riskDomainFromText(reason)
  const action = decision.requiresHumanReview
    ? 'human_review_then_apply_versioned_mitigation_and_verify'
    : 'apply_versioned_mitigation_and_verify'
  return [
    `scope=${safeId(scope)}`,
    `risk_domain=${domain}`,
    `risk_type=${decision.riskType}`,
    `severity=${decision.severity}`,
    `confidence=${decision.confidence}`,
    `evidence=${decision.evidence}`,
    `affected_assets=${affectedAssets}`,
    `action=${action}`,
    'mitigation=pending_versioned_diff',
    'residual_risk=verify_post_condition',
  ].join(' | ')
}

function ensureRiskBeforeReview(
  proposal: AgentProposal,
  nodes: PipelineNode[],
  edges: Edge[],
  options: { anchor?: PipelineNode; branchId: string; reason: string; reviewId: string; risk: HostRiskDecision },
) {
  const allNodes = [...nodes.filter((node) => !proposal.addedNodes.some((added) => added.id === node.id)), ...proposal.addedNodes]
  const graphEdges = activeEdges(proposal, edges)
  const upstreamRisk = allNodes.find((node) => node.data.kind === 'risk' && reachesTarget(node.id, options.reviewId, graphEdges))
  if (upstreamRisk) return

  const riskId = `risk-host-${options.branchId}`.slice(0, 118)
  if (allNodes.some((node) => node.id === riskId)) return
  const review = allNodes.find((node) => node.id === options.reviewId)
  if (!review) return
  const anchorReachable = reachableDistances(options.anchor?.id, graphEdges)
  const incoming = graphEdges
    .filter((edge) => edge.target === options.reviewId && edge.sourceHandle !== 'feedback')
    .sort((left, right) => Number(anchorReachable.has(right.source)) - Number(anchorReachable.has(left.source)))[0]
  const predecessorId = incoming?.source ?? options.anchor?.id
  if (!predecessorId) return

  const risk: PipelineNode = {
    id: riskId,
    type: 'pipeline',
    position: { x: Math.max(0, review.position.x - 320), y: review.position.y },
    data: {
      kind: 'risk',
      label: `Host risk · ${options.risk.severity.toUpperCase()}`,
      description: `Evidence-backed risk preserved before mitigation. ${options.reason} Any protection or Compatibility Patch remains a versioned diff and must pass a fresh post-condition before this risk can be marked mitigated.`,
      owner: 'SAM LAB Agent',
      status: 'draft',
      schema: [],
      rule: riskRule(options.risk, options.anchor?.data.label ?? options.branchId, options.reason),
      agentAdded: true,
    },
  }
  proposal.addedNodes.push(risk)

  if (incoming) {
    proposal.addedEdges = proposal.addedEdges.filter((edge) => edge.id !== incoming.id)
    if (edges.some((edge) => edge.id === incoming.id) && !proposal.removedEdgeIds.includes(incoming.id)) {
      proposal.removedEdgeIds.push(incoming.id)
    }
  }
  const current = activeEdges(proposal, edges)
  proposal.addedEdges.push({
    id: uniqueEdgeId(`edge-${options.branchId}-host-risk`, current),
    source: predecessorId,
    target: riskId,
    sourceHandle: incoming?.sourceHandle,
    type: 'elastic',
  })
  proposal.addedEdges.push({
    id: uniqueEdgeId(`edge-${options.branchId}-risk-review`, [...current, ...proposal.addedEdges]),
    source: riskId,
    target: options.reviewId,
    type: 'elastic',
  })
}

export function ensureHostReviewCheckpoint(
  proposal: AgentProposal,
  nodes: PipelineNode[],
  edges: Edge[],
  options: { anchorId?: string; reason: string; risk?: HostRiskDecision },
) {
  proposal.requiresHumanReview = true
  if (!proposal.rationale.includes('Host risk gate:')) proposal.rationale = `${proposal.rationale}\n\nHost risk gate: ${options.reason}`.trim()

  const anchor = nodes.find((node) => node.id === options.anchorId)
    ?? proposal.addedNodes.find((node) => node.id === options.anchorId)
    ?? proposal.addedNodes.find((node) => node.data.kind !== 'control' && node.data.kind !== 'explorer')
    ?? nodes.find((node) => node.data.kind === 'monitor' || node.data.kind === 'source')
  const branchId = safeId(options.anchorId ?? anchor?.id ?? proposal.id)
  const allNodes = [...nodes.filter((node) => !proposal.addedNodes.some((added) => added.id === node.id)), ...proposal.addedNodes]
  const graphEdges = activeEdges(proposal, edges)
  const distances = reachableDistances(anchor?.id, graphEdges)
  const touchedReviewIds = new Set([
    ...proposal.addedNodes.filter((node) => node.data.kind === 'review').map((node) => node.id),
    ...proposal.updatedNodes
      .filter((update) => nodes.find((node) => node.id === update.nodeId)?.data.kind === 'review')
      .map((update) => update.nodeId),
  ])
  let review = allNodes
    .filter((node) => node.data.kind === 'review' && distances.has(node.id))
    .sort((left, right) => (distances.get(left.id) ?? Infinity) - (distances.get(right.id) ?? Infinity))[0]
    ?? allNodes.find((node) => node.data.kind === 'review' && touchedReviewIds.has(node.id))
    ?? allNodes.find((node) => node.data.kind === 'review' && node.data.rule?.includes(`branch_id=${branchId}`))

  if (review) {
    if (!proposal.addedNodes.some((node) => node.id === review!.id)
      && !proposal.updatedNodes.some((update) => update.nodeId === review!.id)) {
      proposal.updatedNodes.push({
        nodeId: review.id,
        reason: options.reason,
        patch: {
          status: 'draft',
          runState: 'waiting',
          description: options.reason,
          rule: review.data.rule ?? `checkpoint=host_risk_gate | branch_id=${branchId} | requires=explicit_approval`,
        },
      })
    }
    if (options.risk) ensureRiskBeforeReview(proposal, nodes, edges, {
      anchor,
      branchId,
      reason: options.reason,
      reviewId: review.id,
      risk: options.risk,
    })
    return
  }

  const reviewId = `review-host-${branchId}`.slice(0, 118)
  const outputId = `output-host-${branchId}`.slice(0, 118)
  const occupied = new Set(allNodes.map((node) => node.id))
  if (occupied.has(reviewId)) return
  const x = (anchor?.position.x ?? 120) + 320
  const y = (anchor?.position.y ?? 120) + 180
  review = {
    id: reviewId,
    type: 'pipeline',
    position: { x, y },
    data: {
      kind: 'review',
      label: 'Review host risk decision',
      description: options.reason,
      owner: 'Data Steward',
      status: 'draft',
      schema: [],
      rule: `checkpoint=host_risk_gate | branch_id=${branchId} | requires=explicit_approval`,
      agentAdded: true,
    },
  }
  proposal.addedNodes.push(review, {
    id: outputId,
    type: 'pipeline',
    position: { x: x + 320, y },
    data: {
      kind: 'output',
      label: 'Reviewed branch outcome',
      description: 'Emits the branch result only after the host risk checkpoint is approved.',
      owner: 'SAM LAB Agent',
      status: 'draft',
      schema: [],
      rule: `emit=reviewed_branch | branch_id=${branchId}`,
      agentAdded: true,
    },
  })
  if (anchor) proposal.addedEdges.push({
    id: `edge-${branchId}-host-review`,
    source: anchor.id,
    target: reviewId,
    type: 'elastic',
  })
  proposal.addedEdges.push({
    id: `edge-${branchId}-host-output`,
    source: reviewId,
    target: outputId,
    type: 'elastic',
  })
  if (options.risk) ensureRiskBeforeReview(proposal, nodes, edges, {
    anchor,
    branchId,
    reason: options.reason,
    reviewId,
    risk: options.risk,
  })

  const duplicateEdgeIds = new Set<string>()
  proposal.addedEdges = proposal.addedEdges.filter((edge) => {
    const key = `${edge.source}:${edge.sourceHandle ?? ''}->${edge.target}:${edge.targetHandle ?? ''}`
    if (duplicateEdgeIds.has(key) || edges.some((current) => `${current.source}:${current.sourceHandle ?? ''}->${current.target}:${current.targetHandle ?? ''}` === key)) return false
    duplicateEdgeIds.add(key)
    return true
  })
}
