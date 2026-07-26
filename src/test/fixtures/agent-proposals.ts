import type { Edge } from '@xyflow/react'
import type { AgentProposal, PipelineNode } from '../../domain/pipeline'

// Deterministic agent behavior belongs only in tests. Production proposals come from the connected model.
export function governanceProposalFixture(nodes: PipelineNode[], edges: Edge[], uncertain = false): AgentProposal {
  const source = nodes.find((node) => node.data.kind === 'source')
  const fields = (source?.data.schema ?? []).filter((field) => field.tags?.some((tag) => /pii|sensitive/i.test(tag))).map((field) => field.name)
  const decision = nodes.find((node) => node.data.kind === 'decision')
  const incoming = decision ? edges.find((edge) => edge.target === decision.id) : undefined
  if (uncertain) return {
    id: 'test-review', title: 'Test uncertain review', summary: 'Test fixture', rationale: 'Test fixture', datahubReads: [], writeback: '', addedNodes: [], addedEdges: [], removedEdgeIds: [],
    updatedNodes: decision ? [{ nodeId: decision.id, patch: { kind: 'review', status: 'draft' }, reason: 'Test fixture uncertainty' }] : [],
  }
  const transform: PipelineNode = {
    id: 'test-protect-sensitive', type: 'pipeline', position: { x: 1100, y: 70 },
    data: { kind: 'transform', label: `Protect ${fields.join(', ')}`, description: 'Test-only protection fixture', owner: 'Test', status: 'draft', schema: [], rule: fields.map((field) => `sha256(${field}) AS ${field}_hash; drop ${field}`).join('\n'), agentAdded: true },
  }
  return {
    id: 'test-protection', title: 'Test protection', summary: 'Test fixture', rationale: 'Test fixture', datahubReads: [], writeback: '',
    addedNodes: [transform], updatedNodes: [], removedEdgeIds: incoming ? [incoming.id] : [],
    addedEdges: decision && incoming ? [
      { id: 'test-edge-in', source: incoming.source, target: transform.id, type: 'smoothstep' },
      { id: 'test-edge-out', source: transform.id, target: decision.id, type: 'smoothstep' },
    ] : [],
  }
}
