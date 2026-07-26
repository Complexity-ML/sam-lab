import type { Edge } from '@xyflow/react'
import type { RefObject } from 'react'
import { applyAtomicRunState, resumePipelineAtomically, type AtomicPipelineRun } from '../domain/atomic-execution'
import { recordDiagnostic } from '../domain/diagnostics'
import type { PipelineNode } from '../domain/pipeline'
import { errorMessage } from '../domain/toasts'

export function useAtomicReviewResolver(activeRun: RefObject<AtomicPipelineRun | undefined>) {
  return (candidateNodes: PipelineNode[], candidateEdges: Edge[], decision: 'approved' | 'rejected') => {
    const previous = activeRun.current
    if (!previous || previous.state !== 'waiting') return candidateNodes
    const reviewDecisions = Object.fromEntries(candidateNodes
      .filter((node) => node.data.kind === 'review' && previous.nodeStates[node.id] === 'waiting')
      .map((node) => [node.id, decision]))
    if (Object.keys(reviewDecisions).length === 0) return candidateNodes
    try {
      const resumed = resumePipelineAtomically(candidateNodes, candidateEdges, previous, reviewDecisions)
      activeRun.current = resumed
      return applyAtomicRunState(candidateNodes, resumed)
    } catch (error) {
      recordDiagnostic({ category: 'provider', action: 'branch.resume', status: 'error', detail: { decision, message: errorMessage(error, 'Unknown resume error') } })
      return candidateNodes
    }
  }
}
