import type { Edge } from '@xyflow/react'
import { cardLabels, type CardKind, type PipelineNode } from './pipeline'

export const graphPerformanceTargets = {
  targetNodes: 300,
  targetEdges: 420,
  interactionFrameMs: 16.7,
  fixtureBuildMs: 120,
  minimapNodeLimit: 200,
} as const

export interface GraphInteractionProfile {
  dragUpdateMs: number
  elasticRenderMs: number
  fixtureBuildMs: number
  minimapUpdateMs: number
  panZoomProjectionMs: number
}

const kinds: CardKind[] = ['control', 'explorer', 'worker', 'query', 'source', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output']

export function createLargeGraphFixture(nodeCount: number = graphPerformanceTargets.targetNodes): { nodes: PipelineNode[]; edges: Edge[] } {
  const boundedCount = Math.max(1, Math.min(nodeCount, 1_000))
  const nodes = Array.from({ length: boundedCount }, (_, index): PipelineNode => {
    const kind = kinds[index % kinds.length]
    return {
      id: `perf-${index}`,
      type: 'pipeline',
      position: { x: 80 + (index % 20) * 270, y: 80 + Math.floor(index / 20) * 165 },
      data: { kind, label: `${cardLabels[kind]} ${index + 1}`, description: 'Synthetic performance fixture', owner: 'Performance lab', status: 'healthy', schema: [] },
    }
  })
  const edges: Edge[] = []
  for (let index = 1; index < nodes.length; index += 1) edges.push({ id: `perf-edge-${index - 1}-${index}`, source: nodes[index - 1].id, target: nodes[index].id, type: 'elastic' })
  for (let index = 0; index + 20 < nodes.length && edges.length < graphPerformanceTargets.targetEdges; index += 2) edges.push({ id: `perf-cross-${index}-${index + 20}`, source: nodes[index].id, target: nodes[index + 20].id, type: 'elastic' })
  return { nodes, edges }
}

function elapsed(operation: () => void) {
  const startedAt = performance.now()
  operation()
  return performance.now() - startedAt
}

export function profileLargeGraphInteractions(nodeCount: number = graphPerformanceTargets.targetNodes): GraphInteractionProfile {
  let fixture = { nodes: [] as PipelineNode[], edges: [] as Edge[] }
  const fixtureBuildMs = elapsed(() => { fixture = createLargeGraphFixture(nodeCount) })
  const positions = new Map(fixture.nodes.map((node) => [node.id, node.position]))
  const middleNode = fixture.nodes[Math.floor(fixture.nodes.length / 2)]
  const dragUpdateMs = elapsed(() => {
    fixture.nodes = fixture.nodes.map((node) => node.id === middleNode.id ? { ...node, position: { x: node.position.x + 18, y: node.position.y + 12 } } : node)
  })
  const elasticRenderMs = elapsed(() => {
    fixture.edges.map((edge) => {
      const source = positions.get(edge.source) ?? { x: 0, y: 0 }
      const target = positions.get(edge.target) ?? { x: 0, y: 0 }
      const distance = Math.max(72, Math.abs(target.x - source.x) * 0.42)
      return `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`
    })
  })
  const minimapUpdateMs = elapsed(() => {
    fixture.nodes.slice(0, graphPerformanceTargets.minimapNodeLimit).map((node) => ({ id: node.id, x: node.position.x / 20, y: node.position.y / 20, kind: node.data.kind }))
  })
  const panZoomProjectionMs = elapsed(() => {
    fixture.nodes.map((node) => ({ x: node.position.x * 0.85 + 24, y: node.position.y * 0.85 + 18 }))
  })
  return { dragUpdateMs, elasticRenderMs, fixtureBuildMs, minimapUpdateMs, panZoomProjectionMs }
}
