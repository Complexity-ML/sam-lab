import { describe, expect, it } from 'vitest'
import { elasticFeedbackPath, elasticHorizontalPath, routeElasticCable } from '../components/shared/ElasticEdge'
import { connectedLayoutNodeIds, layoutPipeline } from './layout'
import { customerActivationEdges as initialEdges, customerActivationNodes as initialNodes, newCard } from './pipeline'

describe('pipeline XY layout', () => {
  it('places every lineage edge from left to right', () => {
    const arranged = layoutPipeline(initialNodes, initialEdges)
    const position = new Map(arranged.map((node) => [node.id, node.position]))
    for (const edge of initialEdges) expect(position.get(edge.source)!.x).toBeLessThan(position.get(edge.target)!.x)
  })

  it('keeps approved split branches above quarantine branches', () => {
    const arranged = layoutPipeline(initialNodes, initialEdges)
    const approved = arranged.find((node) => node.id === 'normalize-customer')!
    const quarantine = arranged.find((node) => node.id === 'quarantine-output')!
    expect(approved.position.y).toBeLessThan(quarantine.position.y)
  })

  it('does not reposition a cyclic graph', () => {
    const cycle = [...initialEdges, { id: 'cycle', source: 'activation-output', target: 'customers-source' }]
    expect(layoutPipeline(initialNodes, cycle)).toBe(initialNodes)
  })

  it('renders elastic cables as cubic curves instead of square steps', () => {
    const path = elasticHorizontalPath(10, 20, 310, 140)
    expect(path).toContain(' C ')
    expect(path).toContain('310 140')
  })

  it('keeps elastic cables cubic while endpoints move between frames', () => {
    const frames = [
      { sourceX: 10, sourceY: 20, targetX: 310, targetY: 140 },
      { sourceX: 34, sourceY: 52, targetX: 278, targetY: 196 },
      { sourceX: 82, sourceY: 104, targetX: 220, targetY: 76 },
    ]
    const paths = frames.map(({ sourceX, sourceY, targetX, targetY }) => {
      const path = elasticHorizontalPath(sourceX, sourceY, targetX, targetY)
      expect(path).toMatch(new RegExp(`^M ${sourceX} ${sourceY} L .+ C [-\\d.]+ [-\\d.]+, [-\\d.]+ [-\\d.]+, [-\\d.]+ [-\\d.]+ L ${targetX} ${targetY}$`))
      expect(path.match(/ C /g)).toHaveLength(1)
      expect(path).not.toMatch(/ [HV] /)
      return path
    })

    expect(new Set(paths).size).toBe(frames.length)
  })

  it('routes feedback cables below the bounded iteration instead of through its cards', () => {
    const path = elasticFeedbackPath(900, 180, 420, 320)
    expect(path.match(/ C /g)).toHaveLength(2)
    expect(path).toContain('452')
    expect(path).toMatch(/^M 900 180 L 918 180/)
    expect(path).toMatch(/L 420 320$/)
  })

  it('routes an elastic cable around a card in its direct corridor', () => {
    const route = routeElasticCable({
      sourceId: 'source',
      sourceX: 300,
      sourceY: 260,
      targetId: 'target',
      targetX: 900,
      targetY: 260,
      obstacles: [{ id: 'middle', x: 520, y: 160, width: 232, height: 240 }],
    })

    expect(route.routedAroundObstacle).toBe(true)
    expect(route.labelY).toBeLessThan(160)
    expect(route.path.match(/ C /g)).toHaveLength(2)
    expect(route.path).toContain(` ${route.labelY}`)
  })

  it('does not create a detour for a card outside the actual diagonal curve', () => {
    const route = routeElasticCable({
      sourceId: 'profile',
      sourceX: 764,
      sourceY: 655,
      targetId: 'review',
      targetX: 890,
      targetY: 249,
      obstacles: [{ id: 'explorer', x: 839, y: 600, width: 232, height: 288 }],
    })

    expect(route.routedAroundObstacle).toBe(false)
    expect(route.path.match(/ C /g)).toHaveLength(1)
  })

  it('keeps a compact elastic cable when vertically separated endpoint handles share the same X', () => {
    const route = routeElasticCable({
      sourceId: 'source',
      sourceX: 503,
      sourceY: 633,
      targetId: 'profile',
      targetX: 503,
      targetY: 311,
      obstacles: [
        { id: 'source', x: 115, y: 475, width: 388, height: 316 },
        { id: 'profile', x: 503, y: 123, width: 381, height: 378 },
      ],
    })

    expect(route.routedAroundObstacle).toBe(false)
    expect(route.labelX).toBe(503)
    expect(route.path).toMatch(/^M 503 633 /)
    expect(route.path).toMatch(/L 503 311$/)
    expect(route.path.match(/ C /g)).toHaveLength(1)
  })

  it('routes feedback below the tallest card in the iteration', () => {
    const route = routeElasticCable({
      feedback: true,
      sourceId: 'output',
      sourceX: 1_100,
      sourceY: 300,
      targetId: 'monitor',
      targetX: 420,
      targetY: 360,
      obstacles: [{ id: 'risk', x: 680, y: 180, width: 232, height: 420 }],
    })

    expect(route.labelY).toBeGreaterThan(600)
    expect(route.path.match(/ C /g)).toHaveLength(2)
  })

  it('preserves pinned manual card positions while arranging the surrounding graph', () => {
    const pinned = initialNodes.map((node) => node.id === 'region-split' ? { ...node, position: { x: 777, y: 555 }, data: { ...node.data, pinned: true } } : node)
    const arranged = layoutPipeline(pinned, initialEdges)
    expect(arranged.find((node) => node.id === 'region-split')?.position).toEqual({ x: 777, y: 555 })
    expect(arranged.find((node) => node.id === 'customers-source')?.position).not.toEqual(initialNodes.find((node) => node.id === 'customers-source')?.position)
  })

  it('orders adjacent layers to remove avoidable crossed cables', () => {
    const topLeft = { ...newCard('source', 0), id: 'top-left', position: { x: 0, y: 0 } }
    const bottomLeft = { ...newCard('source', 1), id: 'bottom-left', position: { x: 0, y: 300 } }
    const topRight = { ...newCard('output', 2), id: 'top-right', position: { x: 300, y: 0 } }
    const bottomRight = { ...newCard('output', 3), id: 'bottom-right', position: { x: 300, y: 300 } }
    const edges = [{ id: 'cross-a', source: 'top-left', target: 'bottom-right' }, { id: 'cross-b', source: 'bottom-left', target: 'top-right' }]
    const arranged = layoutPipeline([topLeft, bottomLeft, topRight, bottomRight], edges)
    const positions = new Map(arranged.map((node) => [node.id, node.position]))
    const sourceOrder = positions.get('top-left')!.y - positions.get('bottom-left')!.y
    const targetOrder = positions.get('bottom-right')!.y - positions.get('top-right')!.y
    expect(sourceOrder * targetOrder).toBeGreaterThanOrEqual(0)
  })

  it('reserves a floating lane for the orphaned SAM LAB Controller', () => {
    const control = { ...newCard('control', 0), id: 'sam-lab-control' }
    const source = { ...newCard('source', 1), id: 'governed-source' }
    const validation = { ...newCard('validation', 2), id: 'governed-validation' }
    const output = { ...newCard('output', 3), id: 'governed-output' }
    const edges = [
      { id: 'source-validation', source: source.id, target: validation.id },
      { id: 'validation-output', source: validation.id, target: output.id },
    ]

    const arranged = layoutPipeline([control, source, validation, output], edges)
    const controlPosition = arranged.find((node) => node.id === control.id)!.position
    const lineageTop = Math.min(...arranged.filter((node) => node.id !== control.id).map((node) => node.position.y))

    expect(controlPosition.y).toBeLessThan(lineageTop)
    expect(lineageTop - controlPosition.y).toBeGreaterThanOrEqual(240)
  })

  it('places Controller and Catalog Explorer together above lineage', () => {
    const control = { ...newCard('control', 0), id: 'control' }
    const explorer = { ...newCard('explorer', 1), id: 'explorer' }
    const source = { ...newCard('source', 2), id: 'source' }
    const output = { ...newCard('output', 3), id: 'output' }
    const arranged = layoutPipeline([control, explorer, source, output], [{ id: 'path', source: source.id, target: output.id }])
    const system = arranged.filter((node) => node.id === control.id || node.id === explorer.id)
    const lineageTop = Math.min(...arranged.filter((node) => node.id === source.id || node.id === output.id).map((node) => node.position.y))

    expect(system.every((node) => node.position.y < lineageTop)).toBe(true)
    expect(new Set(system.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(2)
  })

  it('places only new agent cards around measured existing cards without moving user work', () => {
    const existing = {
      ...newCard('source', 0),
      id: 'existing-source',
      position: { x: 624, y: 336 },
      measured: { width: 232, height: 420 },
    }
    const review = { ...newCard('review', 1), id: 'new-review', position: { x: 624, y: 336 } }
    const output = { ...newCard('output', 2), id: 'new-output', position: { x: 624, y: 336 } }
    const edges = [
      { id: 'existing-review', source: existing.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ]

    const arranged = layoutPipeline([existing, review, output], edges, [review.id, output.id])
    const placedExisting = arranged.find((node) => node.id === existing.id)!
    const placedReview = arranged.find((node) => node.id === review.id)!
    const placedOutput = arranged.find((node) => node.id === output.id)!

    expect(placedExisting.position).toEqual(existing.position)
    expect(placedReview.position.x).toBeGreaterThan(existing.position.x + existing.measured.width)
    expect(placedOutput.position.x).toBeGreaterThan(placedReview.position.x)
    expect(new Set(arranged.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(3)
  })

  it('reflows host starter cards into a reserved lane during incremental placement', () => {
    const control = { ...newCard('control', 0), id: 'control', position: { x: 72, y: 600 }, measured: { width: 232, height: 240 } }
    const workerBase = newCard('worker', 1)
    const worker = {
      ...workerBase,
      id: 'worker',
      position: { x: 400, y: 600 },
      measured: { width: 232, height: 280 },
      data: { ...workerBase.data, rule: 'role=exploration | batch_size=8 | max_concurrency=4 | retry=checkpoint | context=branch_only | merge=atomic' },
    }
    const explorer = { ...newCard('explorer', 2), id: 'explorer', position: { x: 728, y: 600 }, measured: { width: 232, height: 288 } }
    const profile = { ...newCard('profile', 3), id: 'profile', position: { x: 400, y: 526 }, measured: { width: 232, height: 264 } }
    const review = { ...newCard('review', 4), id: 'review', position: { x: 400, y: 526 } }
    const output = { ...newCard('output', 5), id: 'output', position: { x: 400, y: 526 } }
    const arranged = layoutPipeline(
      [control, worker, explorer, profile, review, output],
      [
        { id: 'profile-review', source: profile.id, target: review.id },
        { id: 'review-output', source: review.id, target: output.id },
      ],
      [review.id, output.id],
    )
    const byId = new Map(arranged.map((node) => [node.id, node]))
    const systemBottom = Math.max(
      byId.get('control')!.position.y + 240,
      byId.get('worker')!.position.y + 280,
      byId.get('explorer')!.position.y + 288,
    )

    expect(byId.get('profile')!.position).toEqual(profile.position)
    expect(systemBottom + 60).toBeLessThanOrEqual(profile.position.y)
    expect(byId.get('review')!.position.x).toBeGreaterThan(profile.position.x + 232)
    expect(byId.get('output')!.position.x).toBeGreaterThan(byId.get('review')!.position.x)
  })

  it('separates variable-height cards that share a topology layer', () => {
    const tallSource = { ...newCard('source', 0), id: 'tall-source', measured: { width: 232, height: 420 } }
    const shortSource = { ...newCard('source', 1), id: 'short-source', measured: { width: 232, height: 280 } }
    const output = { ...newCard('output', 2), id: 'shared-output' }
    const arranged = layoutPipeline(
      [tallSource, shortSource, output],
      [
        { id: 'tall-output', source: tallSource.id, target: output.id },
        { id: 'short-output', source: shortSource.id, target: output.id },
      ],
    )
    const sources = arranged
      .filter((node) => node.data.kind === 'source')
      .sort((left, right) => left.position.y - right.position.y)

    expect(sources[0]!.position.y + (sources[0]!.measured?.height ?? 240)).toBeLessThanOrEqual(sources[1]!.position.y - 60)
  })

  it('places a new middle card between preserved upstream and downstream cards', () => {
    const source = { ...newCard('source', 0), id: 'source', position: { x: 96, y: 240 } }
    const transform = { ...newCard('transform', 1), id: 'transform', position: { x: 96, y: 240 } }
    const output = { ...newCard('output', 2), id: 'output', position: { x: 1_104, y: 240 } }
    const arranged = layoutPipeline(
      [source, transform, output],
      [
        { id: 'source-transform', source: source.id, target: transform.id },
        { id: 'transform-output', source: transform.id, target: output.id },
      ],
      [transform.id],
    )
    const placedTransform = arranged.find((node) => node.id === transform.id)!

    expect(arranged.find((node) => node.id === source.id)!.position).toEqual(source.position)
    expect(arranged.find((node) => node.id === output.id)!.position).toEqual(output.position)
    expect(placedTransform.position.x).toBeGreaterThan(source.position.x + 232)
    expect(placedTransform.position.x + 232).toBeLessThan(output.position.x)
  })

  it('reflows the complete touched business component after an agent correction', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile' }
    const risk = { ...newCard('risk', 2), id: 'risk' }
    const review = { ...newCard('review', 3), id: 'review' }
    const output = { ...newCard('output', 4), id: 'output' }
    const detached = { ...newCard('analysis', 5), id: 'detached' }
    const edges = [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-risk', source: profile.id, target: risk.id },
      { id: 'risk-review', source: risk.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ]
    const touched = connectedLayoutNodeIds([source, profile, risk, review, output, detached], edges, [risk.id])

    expect([...touched]).toEqual(expect.arrayContaining(['source', 'profile', 'risk', 'review', 'output']))
    expect(touched.has(detached.id)).toBe(false)
    const arranged = layoutPipeline([source, profile, risk, review, output, detached], edges, touched)
    const byId = new Map(arranged.map((node) => [node.id, node.position.x]))
    expect(byId.get('source')!).toBeLessThan(byId.get('profile')!)
    expect(byId.get('profile')!).toBeLessThan(byId.get('risk')!)
    expect(byId.get('risk')!).toBeLessThan(byId.get('review')!)
    expect(byId.get('review')!).toBeLessThan(byId.get('output')!)
  })
})
