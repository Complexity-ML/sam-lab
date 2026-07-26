import type { Edge } from '@xyflow/react'
import type { PipelineNode } from '../domain/pipeline'
import { acyclicLineageAtom, cardContractsAtom, dataHubGovernanceAtom, edgeIntegrityAtom, pipelinePresenceAtom, pipelineTerminalsAtom, schemaContractAtom, sensitiveDataAtom } from './atoms'
import type { ValidationAtom, ValidationIssue } from './types'

export const validationAtoms: ValidationAtom[] = [
  pipelinePresenceAtom,
  pipelineTerminalsAtom,
  edgeIntegrityAtom,
  acyclicLineageAtom,
  cardContractsAtom,
  schemaContractAtom,
  sensitiveDataAtom,
  dataHubGovernanceAtom,
]

export function validatePipeline(nodes: PipelineNode[], edges: Edge[]): ValidationIssue[] {
  const context = { nodes, edges }
  return validationAtoms.flatMap((atom) => atom.run(context))
}

/**
 * A reviewed diff may intentionally build a pipeline in small, replayable steps.
 * Missing terminals keep the pipeline non-runnable, but they do not prevent a
 * safe graph transaction. Orphaned lineage cards do block the transaction:
 * every coherent iteration must preserve its connectors. Human Review may be a
 * temporary terminal checkpoint and is handled by its warning-level contract.
 */
export function atomicTransactionBlockers(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => {
    if (issue.severity !== 'error') return false
    if (issue.atomId === 'pipeline-presence' || issue.atomId === 'pipeline-terminals') return false
    return true
  })
}

export type { ValidationAtom, ValidationIssue } from './types'
