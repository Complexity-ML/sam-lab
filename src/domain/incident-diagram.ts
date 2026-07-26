import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'

/**
 * Returns the bounded workstream represented by an Incident Diagram.
 * Upstream traversal stops at Parallel Agents (the branch boundary), while
 * downstream traversal stops at Output cards. Feedback edges belong to the
 * next monitor iteration and are intentionally excluded.
 */
export function incidentDiagramNodeIds(diagramId: string, nodes: PipelineNode[], edges: Edge[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const normalEdges = edges.filter((edge) => edge.sourceHandle !== 'feedback')
  const included = new Set<string>()

  const visitUpstream = (nodeId: string) => {
    if (included.has(nodeId)) return
    const node = byId.get(nodeId)
    if (!node) return
    included.add(nodeId)
    if (node.data.kind === 'parallel') return
    normalEdges.filter((edge) => edge.target === nodeId).forEach((edge) => visitUpstream(edge.source))
  }

  const visitDownstream = (nodeId: string) => {
    const node = byId.get(nodeId)
    if (!node) return
    included.add(nodeId)
    if (node.data.kind === 'output') return
    normalEdges.filter((edge) => edge.source === nodeId).forEach((edge) => visitDownstream(edge.target))
  }

  visitUpstream(diagramId)
  visitDownstream(diagramId)
  return [...included]
}
