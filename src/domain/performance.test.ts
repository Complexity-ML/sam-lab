import { describe, expect, it } from 'vitest'
import { elasticHorizontalPath } from '../components/shared/ElasticEdge'
import { createLargeGraphFixture, graphPerformanceTargets, profileLargeGraphInteractions } from './performance'

describe('large graph performance fixture', () => {
  it('builds and prepares the production target graph within the CPU budget', () => {
    const startedAt = performance.now()
    const fixture = createLargeGraphFixture()
    const renderedEdges = fixture.edges.map((edge, index) => ({ ...edge, path: elasticHorizontalPath(index * 7, index * 3, index * 7 + 240, index * 3 + 80) }))
    const elapsed = performance.now() - startedAt

    expect(fixture.nodes).toHaveLength(graphPerformanceTargets.targetNodes)
    expect(fixture.edges.length).toBeGreaterThanOrEqual(graphPerformanceTargets.targetNodes - 1)
    expect(renderedEdges.every((edge) => edge.path.startsWith('M '))).toBe(true)
    expect(elapsed).toBeLessThan(graphPerformanceTargets.fixtureBuildMs)
  })

  it('bounds oversized fixtures to protect the renderer', () => {
    expect(createLargeGraphFixture(10_000).nodes).toHaveLength(1_000)
  })

  it('profiles drag, elastic edge, minimap and pan/zoom projection work independently', () => {
    const profile = profileLargeGraphInteractions()
    expect(profile.fixtureBuildMs).toBeLessThan(graphPerformanceTargets.fixtureBuildMs)
    expect(profile.dragUpdateMs).toBeLessThan(graphPerformanceTargets.interactionFrameMs)
    expect(profile.elasticRenderMs).toBeLessThan(graphPerformanceTargets.interactionFrameMs)
    expect(profile.minimapUpdateMs).toBeLessThan(graphPerformanceTargets.interactionFrameMs)
    expect(profile.panZoomProjectionMs).toBeLessThan(graphPerformanceTargets.interactionFrameMs)
  })
})
