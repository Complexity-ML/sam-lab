import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { pipelineNodeDimensions } from '../../domain/layout'
import type { PipelineNode } from '../../domain/pipeline'

const feedbackClearance = 132
const obstacleClearance = 44
const cableHitPaddingX = 14
const cableHitPaddingY = 24
const endpointLead = 18

export interface ElasticObstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface ElasticRouteOptions {
  feedback?: boolean
  obstacles?: ElasticObstacle[]
  sourceId?: string
  sourceX: number
  sourceY: number
  targetId?: string
  targetX: number
  targetY: number
}

interface ElasticRoute {
  labelX: number
  labelY: number
  path: string
  routedAroundObstacle: boolean
}

const ElasticRoutingContext = createContext<ElasticObstacle[]>([])

export function ElasticRoutingProvider({ children, nodes }: { children: ReactNode; nodes: PipelineNode[] }) {
  const obstacles = useMemo(() => nodes.map((node) => {
    const dimensions = pipelineNodeDimensions(node)
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      ...dimensions,
    }
  }), [nodes])
  return <ElasticRoutingContext.Provider value={obstacles}>{children}</ElasticRoutingContext.Provider>
}

export function elasticHorizontalPath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const distanceX = Math.abs(targetX - sourceX)
  // Horizontal adaptation of LABO AI's elastic cable: tension follows the
  // primary axis only, so a tall branch does not produce a huge sideways arc.
  // Handles keep their semantic orientation even after manual repositioning:
  // always leave a right-side source to the right and approach a left-side
  // target from the left. Backward and vertical links therefore form a small
  // elastic S instead of escaping into a giant square lane.
  const tension = Math.max(42, Math.min(180, distanceX * 0.42))
  const sourceLeadX = sourceX + endpointLead
  const targetLeadX = targetX - endpointLead
  return `M ${sourceX} ${sourceY} L ${sourceLeadX} ${sourceY} C ${sourceX + tension} ${sourceY}, ${targetX - tension} ${targetY}, ${targetLeadX} ${targetY} L ${targetX} ${targetY}`
}

export function elasticFeedbackPath(sourceX: number, sourceY: number, targetX: number, targetY: number, forcedRouteY?: number) {
  const lead = endpointLead
  // Handles sit near the vertical center of cards that can reach 192 px tall.
  // Clear the half-height plus a visible margin before turning the loop.
  const routeY = forcedRouteY ?? Math.max(sourceY, targetY) + feedbackClearance
  const midpointX = (sourceX + targetX) / 2
  return `M ${sourceX} ${sourceY} L ${sourceX + lead} ${sourceY} C ${sourceX + 72} ${sourceY}, ${sourceX + 72} ${routeY}, ${midpointX} ${routeY} C ${targetX - 72} ${routeY}, ${targetX - 72} ${targetY}, ${targetX - lead} ${targetY} L ${targetX} ${targetY}`
}

function intersectsCableCorridor(obstacle: ElasticObstacle, options: ElasticRouteOptions) {
  const lead = endpointLead
  const tension = Math.max(42, Math.min(180, Math.abs(options.targetX - options.sourceX) * 0.42))
  const points = [
    { x: options.sourceX, y: options.sourceY },
    ...Array.from({ length: 31 }, (_, index) => {
      const t = (index + 1) / 32
      const inverse = 1 - t
      return {
        x: inverse ** 3 * (options.sourceX + lead)
          + 3 * inverse ** 2 * t * (options.sourceX + tension)
          + 3 * inverse * t ** 2 * (options.targetX - tension)
          + t ** 3 * (options.targetX - lead),
        y: inverse ** 3 * options.sourceY
          + 3 * inverse ** 2 * t * options.sourceY
          + 3 * inverse * t ** 2 * options.targetY
          + t ** 3 * options.targetY,
      }
    }),
    { x: options.targetX, y: options.targetY },
  ]
  const left = obstacle.x - cableHitPaddingX
  const right = obstacle.x + obstacle.width + cableHitPaddingX
  const top = obstacle.y - cableHitPaddingY
  const bottom = obstacle.y + obstacle.height + cableHitPaddingY
  return points.some((point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom)
}

function routedCablePath(options: ElasticRouteOptions, routeY: number) {
  const { sourceX, sourceY, targetX, targetY } = options
  const turn = Math.max(endpointLead + 32, Math.min(76, Math.abs(targetX - sourceX) * 0.22))
  // React Flow exposes the output handle on the right and the input handle on
  // the left. Always honour those physical directions, including when a user
  // moves the target above or behind its source. Reversing both turns with the
  // graph direction produced crossed, bow-shaped cables.
  const sourceTurnX = sourceX + turn
  const targetTurnX = targetX - turn
  const curve = Math.max(10, Math.min(28, Math.abs(routeY - sourceY) * 0.24))
  return [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX + endpointLead} ${sourceY}`,
    `C ${sourceTurnX - curve} ${sourceY}, ${sourceTurnX - curve} ${routeY}, ${sourceTurnX} ${routeY}`,
    `L ${targetTurnX} ${routeY}`,
    `C ${targetTurnX + curve} ${routeY}, ${targetTurnX + curve} ${targetY}, ${targetX - endpointLead} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ')
}

export function routeElasticCable(options: ElasticRouteOptions): ElasticRoute {
  const needsTurnaround = options.targetX <= options.sourceX + endpointLead * 4
  const obstacles = (options.obstacles ?? []).filter((obstacle) => (
    obstacle.id !== options.sourceId
    && obstacle.id !== options.targetId
    && intersectsCableCorridor(obstacle, options)
  ))
  const midpointX = (options.sourceX + options.targetX) / 2
  if (!options.feedback && !needsTurnaround && obstacles.length === 0) {
    return {
      path: elasticHorizontalPath(options.sourceX, options.sourceY, options.targetX, options.targetY),
      labelX: midpointX,
      labelY: (options.sourceY + options.targetY) / 2,
      routedAroundObstacle: false,
    }
  }

  const spanningObstacles = (options.obstacles ?? []).filter((obstacle) => {
    if (obstacle.id === options.sourceId || obstacle.id === options.targetId) return false
    const left = Math.min(options.sourceX, options.targetX)
    const right = Math.max(options.sourceX, options.targetX)
    return obstacle.x < right && obstacle.x + obstacle.width > left
  })
  // Once a direct collision is detected, clear every card spanning the same
  // horizontal interval. Otherwise choosing the lower lane to avoid one card
  // can accidentally route through a second card that sat just outside the
  // original endpoint corridor.
  const endpointObstacles = (options.obstacles ?? []).filter((obstacle) => (
    obstacle.id === options.sourceId || obstacle.id === options.targetId
  ))
  // A turnaround and a feedback loop must also clear the endpoint card
  // bodies. Handles are vertically centred and SAM profile/explorer cards can
  // be substantially taller than the original fixed estimate.
  const routeObstacles = options.feedback || needsTurnaround
    ? [...spanningObstacles, ...endpointObstacles]
    : spanningObstacles
  const above = Math.min(
    options.sourceY,
    options.targetY,
    ...routeObstacles.map((obstacle) => obstacle.y),
  ) - obstacleClearance
  const below = Math.max(
    options.sourceY,
    options.targetY,
    ...routeObstacles.map((obstacle) => obstacle.y + obstacle.height),
  ) + obstacleClearance
  const routeY = options.feedback
    ? Math.max(below, Math.max(options.sourceY, options.targetY) + feedbackClearance)
    : Math.abs(options.sourceY - above) + Math.abs(options.targetY - above)
      <= Math.abs(options.sourceY - below) + Math.abs(options.targetY - below)
      ? above
      : below
  return {
    path: options.feedback
      ? elasticFeedbackPath(options.sourceX, options.sourceY, options.targetX, options.targetY, routeY)
      : routedCablePath(options, routeY),
    labelX: midpointX,
    labelY: routeY,
    routedAroundObstacle: true,
  }
}

export function ElasticEdge({ id, label, markerEnd, selected, source, sourceHandleId, sourceX, sourceY, style, target, targetX, targetY }: EdgeProps) {
  const feedback = sourceHandleId === 'feedback' || label === 'next iteration'
  const obstacles = useContext(ElasticRoutingContext)
  const route = routeElasticCable({ feedback, obstacles, sourceId: source, sourceX, sourceY, targetId: target, targetX, targetY })
  const edgeStyle = selected ? { ...style, stroke: '#6366f1', strokeWidth: 2.2 } : style
  return <>
    <BaseEdge id={id} interactionWidth={28} markerEnd={markerEnd} path={route.path} style={edgeStyle} />
    {label !== undefined && <EdgeLabelRenderer><span className="elastic-edge-label" style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)` }}>{label}</span></EdgeLabelRenderer>}
  </>
}
