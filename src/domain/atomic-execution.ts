import type { Edge } from '@xyflow/react'
import { cardLabels, type AgentRunTraceStep, type PipelineNode } from './pipeline'

export type AtomicRunState = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export interface AtomicExecutionEvent {
  nodeId: string
  sequence: number
  state: Exclude<AtomicRunState, 'idle'>
  message: string
}

export interface AtomicBranchResult {
  outputId: string
  state: 'waiting' | 'completed' | 'failed' | 'stopped'
}

export interface AtomicPipelineRun {
  started: boolean
  state: AtomicRunState
  nodeStates: Record<string, AtomicRunState>
  nodeFingerprints: Record<string, string>
  events: AtomicExecutionEvent[]
  branches: AtomicBranchResult[]
  reason?: string
}

interface AtomicExecutionOptions {
  reviewDecisions?: Record<string, 'approved' | 'rejected' | 'pending'>
  shouldStop?(completedNodeIds: string[]): boolean
  resumeFrom?: AtomicPipelineRun
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) result[key] = stableValue(entry)
      return result
    }, {})
}

function cardContract(node: PipelineNode) {
  const {
    runState: _runState,
    runSequence: _runSequence,
    runFingerprint: _runFingerprint,
    ...contract
  } = node.data
  return contract
}

/**
 * Builds a durable input fingerprint for every card. Feedback edges are a
 * boundary between atomic iterations, so they never invalidate the current
 * iteration. A predecessor edit changes every downstream fingerprint.
 */
export function buildAtomicExecutionFingerprints(nodes: PipelineNode[], edges: Edge[]): Record<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as Edge[]]))
  for (const edge of edges) {
    if (edge.sourceHandle === 'feedback' || !byId.has(edge.source) || !byId.has(edge.target)) continue
    incoming.get(edge.target)!.push(edge)
  }
  const fingerprints: Record<string, string> = {}
  const visiting = new Set<string>()
  const visit = (nodeId: string): string => {
    if (fingerprints[nodeId]) return fingerprints[nodeId]
    const node = byId.get(nodeId)
    if (!node) return 'missing'
    // Validation owns structural cycles. Keep fingerprinting total and
    // deterministic so a malformed draft cannot recurse forever.
    if (visiting.has(nodeId)) return `cycle:${nodeId}`
    visiting.add(nodeId)
    const predecessors = (incoming.get(nodeId) ?? [])
      .map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        fingerprint: visit(edge.source),
      }))
      .sort((left, right) => `${left.source}:${left.sourceHandle}`.localeCompare(`${right.source}:${right.sourceHandle}`))
    visiting.delete(nodeId)
    fingerprints[nodeId] = stableHash(JSON.stringify(stableValue({
      contract: cardContract(node),
      predecessors,
    })))
    return fingerprints[nodeId]
  }
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id))) visit(node.id)
  return fingerprints
}

function branchState(outputId: string, states: Record<string, AtomicRunState>, incoming: Map<string, string[]>): AtomicBranchResult['state'] {
  const outputState = states[outputId]
  if (outputState === 'completed' || outputState === 'failed' || outputState === 'stopped') return outputState
  const queue = [...(incoming.get(outputId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    if (states[id] === 'waiting') return 'waiting'
    if (states[id] === 'failed') return 'failed'
    if (states[id] === 'stopped') return 'stopped'
    queue.push(...(incoming.get(id) ?? []))
  }
  return 'failed'
}

export function executePipelineAtomically(nodes: PipelineNode[], edges: Edge[], options: AtomicExecutionOptions = {}): AtomicPipelineRun {
  const previous = options.resumeFrom
  const nodeFingerprints = buildAtomicExecutionFingerprints(nodes, edges)
  const nodeStates: Record<string, AtomicRunState> = Object.fromEntries(nodes.map<[string, AtomicRunState]>((node) => {
    const previousState = previous?.nodeStates[node.id]
    const unchangedSincePreviousRun = previous?.nodeFingerprints[node.id] === nodeFingerprints[node.id]
    if (unchangedSincePreviousRun && (previousState === 'completed' || previousState === 'failed' || previousState === 'stopped')) return [node.id, previousState]
    if (unchangedSincePreviousRun && previousState === 'waiting' && !options.reviewDecisions?.[node.id]) return [node.id, 'waiting']
    if (!previous && node.data.runState === 'completed' && node.data.runFingerprint === nodeFingerprints[node.id]) return [node.id, 'completed']
    if (!previous && node.data.kind === 'review' && node.data.runState === 'completed') return [node.id, 'completed']
    return [node.id, 'idle' as AtomicRunState]
  }))
  if (nodes.length === 0) return { started: false, state: 'idle', nodeStates, nodeFingerprints, events: [], branches: [], reason: 'A pipeline requires at least one card.' }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback' && byId.has(edge.source) && byId.has(edge.target)) incoming.get(edge.target)!.push(edge.source)
  const events: AtomicExecutionEvent[] = previous ? [...previous.events] : []
  const completed = nodes.filter((node) => nodeStates[node.id] === 'completed').map((node) => node.id)
  let sequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0)
  let progressed = true

  while (progressed) {
    progressed = false
    for (const node of nodes) {
      if (nodeStates[node.id] !== 'idle') continue
      const predecessors = incoming.get(node.id) ?? []
      if (predecessors.some((id) => nodeStates[id] === 'failed')) {
        nodeStates[node.id] = 'failed'
        events.push({ nodeId: node.id, sequence: ++sequence, state: 'failed', message: 'A required predecessor failed.' })
        progressed = true
        continue
      }
      if (predecessors.some((id) => nodeStates[id] === 'stopped')) {
        nodeStates[node.id] = 'stopped'
        events.push({ nodeId: node.id, sequence: ++sequence, state: 'stopped', message: 'Execution was stopped upstream.' })
        progressed = true
        continue
      }
      if (!predecessors.every((id) => nodeStates[id] === 'completed')) continue
      if (options.shouldStop?.(completed)) {
        for (const pending of nodes.filter((candidate) => nodeStates[candidate.id] === 'idle')) nodeStates[pending.id] = 'stopped'
        return { started: true, state: 'stopped', nodeStates, nodeFingerprints, events: [...events, { nodeId: node.id, sequence: ++sequence, state: 'stopped', message: 'Emergency stop accepted before the next atomic card commit.' }], branches: nodes.filter((candidate) => candidate.data.kind === 'output').map((output) => ({ outputId: output.id, state: branchState(output.id, nodeStates, incoming) })), reason: 'Emergency stop prevented all later card commits.' }
      }
      nodeStates[node.id] = 'running'
      events.push({ nodeId: node.id, sequence: ++sequence, state: 'running', message: 'All required predecessors completed.' })
      if (node.data.kind === 'review') {
        const decisionStillApplies = !previous || previous.nodeFingerprints[node.id] === nodeFingerprints[node.id]
        const decision = decisionStillApplies ? options.reviewDecisions?.[node.id] ?? 'pending' : 'pending'
        nodeStates[node.id] = decision === 'approved' ? 'completed' : decision === 'rejected' ? 'failed' : 'waiting'
        events.push({ nodeId: node.id, sequence: ++sequence, state: nodeStates[node.id] as 'completed' | 'failed' | 'waiting', message: decision === 'approved' ? 'Human Review approved.' : decision === 'rejected' ? 'Human Review rejected.' : 'Waiting for explicit Human Review.' })
        if (decision === 'approved') completed.push(node.id)
      } else {
        nodeStates[node.id] = 'completed'
        completed.push(node.id)
        const message = node.data.kind === 'impact'
          ? 'Impact Analysis atom committed from its versioned evidence snapshot.'
          : node.data.kind === 'risk'
            ? 'Risk Assessment atom committed with evidence type, severity, confidence and affected assets kept distinct from collection reliability.'
          : node.data.kind === 'monitor'
            ? 'Live Monitor evaluated one bounded evidence iteration.'
            : node.data.kind === 'worker'
              ? 'Worker Node completed one deterministic bounded batch and exposed an atomic checkpoint.'
            : node.data.kind === 'parallel'
              ? 'Independent agent branches released with branch-only context; token usage remains observable and uncapped.'
            : 'Atomic card commit completed.'
        events.push({ nodeId: node.id, sequence: ++sequence, state: 'completed', message })
      }
      progressed = true
    }
  }

  const outputs = nodes.filter((node) => node.data.kind === 'output')
  const branches = outputs.map((output) => ({ outputId: output.id, state: branchState(output.id, nodeStates, incoming) }))
  const state: AtomicRunState = Object.values(nodeStates).some((value) => value === 'waiting') ? 'waiting'
    : branches.length > 0 && branches.every((branch) => branch.state === 'completed') ? 'completed'
      : 'failed'
  return { started: true, state, nodeStates, nodeFingerprints, events, branches, reason: state === 'failed' ? 'The graph could not complete every terminal branch.' : undefined }
}

export function resumePipelineAtomically(
  nodes: PipelineNode[],
  edges: Edge[],
  previous: AtomicPipelineRun,
  reviewDecisions: Record<string, 'approved' | 'rejected' | 'pending'>,
): AtomicPipelineRun {
  if (!previous.started || previous.state !== 'waiting') throw new Error('Only a waiting atomic run can be resumed.')
  const waitingReviewIds = nodes
    .filter((node) => node.data.kind === 'review' && previous.nodeStates[node.id] === 'waiting')
    .map((node) => node.id)
  if (!waitingReviewIds.some((nodeId) => reviewDecisions[nodeId] === 'approved' || reviewDecisions[nodeId] === 'rejected')) {
    throw new Error('Resume requires an explicit decision for a waiting Human Review card.')
  }
  return executePipelineAtomically(nodes, edges, { reviewDecisions, resumeFrom: previous })
}

export function applyAtomicRunState(nodes: PipelineNode[], run: AtomicPipelineRun): PipelineNode[] {
  const completedSequence = new Map(run.events.filter((event) => event.state === 'completed').map((event) => [event.nodeId, event.sequence]))
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      runState: run.nodeStates[node.id] ?? 'idle',
      runSequence: completedSequence.get(node.id)
        ?? (run.nodeStates[node.id] === 'completed' ? node.data.runSequence : undefined),
      runFingerprint: run.nodeStates[node.id] === 'completed' ? run.nodeFingerprints[node.id] : undefined,
    },
  }))
}

export function isAtomicExecutionCheckpointCurrent(run: AtomicPipelineRun) {
  return run.started && run.state === 'completed' && run.events.length === 0
}

export function buildAtomicRunTrace(nodes: PipelineNode[], run: AtomicPipelineRun): AgentRunTraceStep[] {
  const latest = new Map<string, AtomicExecutionEvent>()
  for (const event of run.events) if (event.state !== 'running') latest.set(event.nodeId, event)
  return nodes.flatMap((node) => {
    const event = latest.get(node.id)
    if (!event || event.state === 'running') return []
    return [{ nodeId: node.id, label: node.data.label, role: cardLabels[node.data.kind], state: event.state, summary: event.message }]
  })
}
