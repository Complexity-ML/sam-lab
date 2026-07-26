import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'
import { parseWorkerPolicy } from './worker-policy'

const cardWidth = 232
// Cards with a wrapped description, rule and footer render much taller than
// their CSS minimum. Keep the layout collision box aligned with the common
// rendered height so neighbouring components cannot visually overlap.
const cardHeight = 240
const gridSpacing = 24
const horizontalGap = 96
const verticalGap = 60
const componentGap = 144
const layoutStartX = 72
const layoutStartY = 72
const horizontalStep = Math.ceil((cardWidth + horizontalGap) / gridSpacing) * gridSpacing
const verticalStep = Math.ceil((cardHeight + verticalGap) / gridSpacing) * gridSpacing

type Position = { x: number; y: number }
type OccupiedBox = Position & { width: number; height: number }

const snap = (value: number) => Math.round(value / gridSpacing) * gridSpacing
const mean = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

function connectedComponents(nodes: PipelineNode[], edges: Edge[], arranged: Set<string>): string[][] {
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const neighbours = new Map([...arranged].map((id) => [id, new Set<string>()]))
  for (const edge of edges) {
    if (!arranged.has(edge.source) || !arranged.has(edge.target)) continue
    neighbours.get(edge.source)?.add(edge.target)
    neighbours.get(edge.target)?.add(edge.source)
  }
  const pending = new Set(arranged)
  const components: string[][] = []
  while (pending.size > 0) {
    const seed = [...pending].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))[0]!
    const queue = [seed]
    const component: string[] = []
    pending.delete(seed)
    while (queue.length > 0) {
      const current = queue.shift()!
      component.push(current)
      for (const neighbour of neighbours.get(current) ?? []) {
        if (!pending.delete(neighbour)) continue
        queue.push(neighbour)
      }
    }
    component.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
    components.push(component)
  }
  return components
}

function topologyLayers(nodes: PipelineNode[], edges: Edge[]): string[][] {
  const order = new Map(nodes.map((node, index) => [node.id, index]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const rank = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) {
    if (!outgoing.has(edge.source) || !indegree.has(edge.target) || edge.source === edge.target) continue
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  queue.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
  const topological: string[] = []
  while (queue.length > 0) {
    const source = queue.shift()!
    topological.push(source)
    for (const target of outgoing.get(source) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(source) ?? 0) + 1))
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) {
        queue.push(target)
        queue.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
      }
    }
  }
  if (topological.length !== nodes.length) throw new Error('Cyclic pipeline')
  const layers: string[][] = []
  for (const id of topological) (layers[rank.get(id) ?? 0] ??= []).push(id)
  return layers.filter(Boolean)
}

function branchPriority(id: string, edges: Edge[]): number {
  const handles = edges.filter((edge) => edge.target === id).map((edge) => edge.sourceHandle)
  if (handles.includes('approved')) return -1
  if (handles.includes('quarantine')) return 1
  return 0
}

/** Repeated down/up barycentric sweeps minimize crossings, as in LABO AI. */
function orderLayers(nodes: PipelineNode[], edges: Edge[], layers: string[][]): string[][] {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source)
    outgoing.get(edge.source)?.push(edge.target)
  }
  const ordered = layers.map((layer) => [...layer])
  const positions = () => new Map(ordered.flatMap((layer) => layer.map((id, index) => [id, index - (layer.length - 1) / 2] as const)))
  const sweep = (direction: 'forward' | 'backward') => {
    const levelOrder = direction === 'forward'
      ? Array.from({ length: ordered.length - 1 }, (_, index) => index + 1)
      : Array.from({ length: ordered.length - 1 }, (_, index) => ordered.length - index - 2)
    for (const level of levelOrder) {
      const currentPositions = positions()
      const neighbours = direction === 'forward' ? incoming : outgoing
      const previous = new Map(ordered[level]!.map((id, index) => [id, index]))
      ordered[level]!.sort((left, right) => {
        const branch = branchPriority(left, edges) - branchPriority(right, edges)
        if (branch !== 0) return branch
        const leftNeighbours = neighbours.get(left) ?? []
        const rightNeighbours = neighbours.get(right) ?? []
        const leftScore = leftNeighbours.length ? mean(leftNeighbours.map((id) => currentPositions.get(id) ?? 0)) : previous.get(left) ?? 0
        const rightScore = rightNeighbours.length ? mean(rightNeighbours.map((id) => currentPositions.get(id) ?? 0)) : previous.get(right) ?? 0
        return leftScore - rightScore || (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0)
      })
    }
  }
  for (let pass = 0; pass < 6; pass += 1) {
    sweep('forward')
    sweep('backward')
  }
  return ordered
}

function nodeDimensions(node: PipelineNode) {
  return {
    width: Math.max(cardWidth, node.measured?.width ?? node.width ?? cardWidth),
    height: Math.max(cardHeight, node.measured?.height ?? node.height ?? cardHeight),
  }
}

function isSystemCard(node: PipelineNode) {
  return node.data.kind === 'control'
    || node.data.kind === 'explorer'
    || (node.data.kind === 'worker' && parseWorkerPolicy(node.data.rule).role === 'exploration')
}

function separatedLayer(ids: string[], desired: Map<string, number>, byId: Map<string, PipelineNode>): Map<string, number> {
  const result = new Map<string, number>()
  let previousId: string | undefined
  for (const id of ids) {
    const previousHeight = previousId ? nodeDimensions(byId.get(previousId)!).height : 0
    const currentHeight = nodeDimensions(byId.get(id)!).height
    const minimum = previousId
      ? (result.get(previousId) ?? 0) + previousHeight / 2 + verticalGap + currentHeight / 2
      : Number.NEGATIVE_INFINITY
    const y = Math.max(desired.get(id) ?? 0, minimum)
    result.set(id, y)
    previousId = id
  }
  const shift = mean([...result.values()]) - mean(ids.map((id) => desired.get(id) ?? 0))
  for (const [id, y] of result) result.set(id, y - shift)
  return result
}

function layoutComponent(nodes: PipelineNode[], edges: Edge[]): { positions: Map<string, Position>; width: number; height: number } {
  const layers = orderLayers(nodes, edges, topologyLayers(nodes, edges))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source)
    outgoing.get(edge.source)?.push(edge.target)
  }
  const y = new Map<string, number>()
  layers.forEach((layer) => {
    let cursor = 0
    for (const id of layer) {
      const height = nodeDimensions(byId.get(id)!).height
      y.set(id, cursor + height / 2)
      cursor += height + verticalGap
    }
    const centerShift = mean(layer.map((id) => y.get(id) ?? 0))
    layer.forEach((id) => y.set(id, (y.get(id) ?? 0) - centerShift))
  })

  const align = (layer: string[], neighbours: Map<string, string[]>) => {
    const desired = new Map<string, number>()
    for (const id of layer) {
      const neighbourY = (neighbours.get(id) ?? []).map((neighbour) => y.get(neighbour)).filter((value): value is number => value !== undefined)
      const branchOffset = branchPriority(id, edges) * verticalStep * 0.5
      desired.set(id, (neighbourY.length > 0 ? mean(neighbourY) : y.get(id) ?? 0) + branchOffset)
    }
    const ordered = [...layer].sort((left, right) => (desired.get(left) ?? 0) - (desired.get(right) ?? 0))
    for (const [id, position] of separatedLayer(ordered, desired, byId)) y.set(id, position)
  }
  for (let pass = 0; pass < 6; pass += 1) {
    for (let level = 1; level < layers.length; level += 1) align(layers[level]!, incoming)
    for (let level = layers.length - 2; level >= 0; level -= 1) align(layers[level]!, outgoing)
  }

  const minY = Math.min(0, ...nodes.map((node) => (y.get(node.id) ?? 0) - nodeDimensions(node).height / 2))
  const maxY = Math.max(0, ...nodes.map((node) => (y.get(node.id) ?? 0) + nodeDimensions(node).height / 2))
  const layerX: number[] = []
  let cursorX = 0
  layers.forEach((layer, level) => {
    layerX[level] = cursorX
    cursorX += Math.max(...layer.map((id) => nodeDimensions(byId.get(id)!).width)) + horizontalGap
  })
  const positions = new Map<string, Position>()
  layers.forEach((layer, level) => layer.forEach((id) => {
    const node = byId.get(id)!
    positions.set(id, {
      x: layerX[level]!,
      y: (y.get(id) ?? 0) - nodeDimensions(node).height / 2 - minY,
    })
  }))
  return {
    positions,
    width: Math.max(cardWidth, cursorX - horizontalGap),
    height: Math.max(cardHeight, maxY - minY),
  }
}

function nodeBox(node: PipelineNode, position = node.position): OccupiedBox {
  return {
    ...position,
    ...nodeDimensions(node),
  }
}

function collides(candidate: OccupiedBox, occupied: OccupiedBox[]): boolean {
  return occupied.some((other) => (
    candidate.x < other.x + other.width + 24
    && candidate.x + candidate.width + 24 > other.x
    && candidate.y < other.y + other.height + 36
    && candidate.y + candidate.height + 36 > other.y
  ))
}

export function findOpenPipelinePosition(nodes: PipelineNode[]): Position {
  if (nodes.length === 0) return { x: layoutStartX, y: layoutStartY }
  const baseX = snap(Math.max(...nodes.map((node) => node.position.x)) + horizontalStep)
  const baseY = snap(Math.min(...nodes.map((node) => node.position.y)))
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 80; row += 1) {
      const candidate = { x: baseX + column * horizontalStep, y: baseY + row * verticalStep }
      if (!collides({ ...candidate, width: cardWidth, height: cardHeight }, nodes.map((node) => nodeBox(node)))) return candidate
    }
  }
  return { x: baseX + 4 * horizontalStep, y: baseY }
}

/**
 * Returns the complete business components touched by an incremental agent
 * transaction. Feedback links participate in component membership but are
 * ignored later when topology ranks are calculated.
 */
export function connectedLayoutNodeIds(nodes: PipelineNode[], edges: Edge[], seedIds: Iterable<string>): Set<string> {
  const existing = new Set(nodes.map((node) => node.id))
  const neighbours = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!existing.has(edge.source) || !existing.has(edge.target)) continue
    neighbours.get(edge.source)?.add(edge.target)
    neighbours.get(edge.target)?.add(edge.source)
  }
  const selected = new Set([...seedIds].filter((id) => existing.has(id)))
  const queue = [...selected]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const neighbour of neighbours.get(current) ?? []) {
      if (selected.has(neighbour)) continue
      selected.add(neighbour)
      queue.push(neighbour)
    }
  }
  return selected
}

/**
 * Topology-aware XY placement adapted from LABO AI for left-to-right lineage.
 * Pass nodeIds to arrange only agent-created cards while preserving user work.
 */
export function layoutPipeline(nodes: PipelineNode[], edges: Edge[], nodeIds?: Iterable<string>): PipelineNode[] {
  const iterationEdges = edges.filter((edge) => edge.sourceHandle !== 'feedback')
  const requested = new Set(nodeIds ?? nodes.map((node) => node.id))
  // Host-owned starter cards form a reserved control lane. Reflow that lane
  // whenever an incremental proposal is placed; otherwise newly added lineage
  // cards can inherit the same XY coordinates and visually cover the starter
  // cards while user-positioned lineage remains untouched.
  const arranged = new Set(nodes
    .filter((node) => !node.data.pinned && (requested.has(node.id) || (nodeIds !== undefined && isSystemCard(node))))
    .map((node) => node.id))
  if (arranged.size === 0) return nodes
  const systemCards = nodes.filter((node) => arranged.has(node.id) && isSystemCard(node))
  const lineageArranged = new Set([...arranged].filter((id) => !systemCards.some((card) => card.id === id)))
  const external = nodes.filter((node) => !arranged.has(node.id))
  const occupied = external.map((node) => nodeBox(node))
  const positions = new Map<string, Position>()
  let fullCursorY = layoutStartY

  try {
    // Controller and Catalog Explorer are host-owned system policies, not
    // lineage atoms. Keep them in a reserved lane so topology never overlaps.
    let systemCursorX = layoutStartX
    const tallestSystemCard = Math.max(cardHeight, ...systemCards.map((card) => nodeDimensions(card).height))
    const externalTop = external.length > 0 ? Math.min(...external.map((node) => node.position.y)) : undefined
    const systemLaneY = externalTop === undefined
      ? layoutStartY
      : Math.min(layoutStartY, snap(externalTop - tallestSystemCard - componentGap))
    let systemBottom = systemLaneY
    for (const card of systemCards) {
      const placed = { x: snap(systemCursorX), y: systemLaneY }
      positions.set(card.id, placed)
      occupied.push(nodeBox(card, placed))
      systemCursorX = placed.x + nodeDimensions(card).width + horizontalGap
      systemBottom = Math.max(systemBottom, placed.y + nodeDimensions(card).height)
    }
    if (systemCards.length > 0) fullCursorY = snap(systemBottom + componentGap)

    const components = connectedComponents(nodes, iterationEdges, lineageArranged)
    for (const componentIds of components) {
      const ids = new Set(componentIds)
      const localNodes = nodes.filter((node) => ids.has(node.id))
      const localEdges = iterationEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      const local = layoutComponent(localNodes, localEdges)
      const incomingAnchors = iterationEdges
        .filter((edge) => !arranged.has(edge.source) && ids.has(edge.target))
        .map((edge) => nodes.find((node) => node.id === edge.source))
        .filter((node): node is PipelineNode => Boolean(node))
      const outgoingAnchors = iterationEdges
        .filter((edge) => ids.has(edge.source) && !arranged.has(edge.target))
        .map((edge) => nodes.find((node) => node.id === edge.target))
        .filter((node): node is PipelineNode => Boolean(node))
      const incomingBoundary = incomingAnchors.length
        ? Math.max(...incomingAnchors.map((node) => node.position.x + nodeDimensions(node).width + horizontalGap))
        : undefined
      const outgoingBoundary = outgoingAnchors.length
        ? Math.min(...outgoingAnchors.map((node) => node.position.x - local.width - horizontalGap))
        : undefined
      let baseX = external.length === 0
        ? layoutStartX
        : incomingBoundary !== undefined && outgoingBoundary !== undefined && incomingBoundary <= outgoingBoundary
          ? (incomingBoundary + outgoingBoundary) / 2
          : incomingBoundary ?? outgoingBoundary ?? Math.max(layoutStartX, ...external.map((node) => node.position.x + nodeDimensions(node).width + horizontalGap))
      const anchorCenters = [...incomingAnchors, ...outgoingAnchors].map((node) => node.position.y + nodeDimensions(node).height / 2)
      let baseY = external.length === 0 ? fullCursorY : anchorCenters.length ? mean(anchorCenters) - local.height / 2 : layoutStartY
      baseX = snap(baseX)
      baseY = snap(baseY)
      if (external.length > 0) {
        const offsets = [0, ...Array.from({ length: 40 }, (_, index) => [index + 1, -(index + 1)]).flat()]
        const clear = offsets.find((step) => [...local.positions].every(([id, position]) => {
          const node = localNodes.find((candidate) => candidate.id === id)!
          return !collides(nodeBox(node, { x: position.x + baseX, y: position.y + baseY + step * verticalStep }), occupied)
        }))
        baseY = clear === undefined
          ? snap(Math.max(layoutStartY, ...occupied.map((position) => position.y + position.height + verticalGap)))
          : baseY + clear * verticalStep
      }
      for (const [id, position] of local.positions) {
        const placed = { x: snap(position.x + baseX), y: snap(position.y + baseY) }
        positions.set(id, placed)
        occupied.push(nodeBox(localNodes.find((node) => node.id === id)!, placed))
      }
      if (external.length === 0) fullCursorY += local.height + componentGap
    }
  } catch {
    return nodes
  }

  return nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)
}
