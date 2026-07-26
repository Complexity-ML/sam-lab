import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { incidentDiagramNodeIds } from './incident-diagram'
import { newCard, type CardKind, type PipelineNode } from './pipeline'

function card(id: string, kind: CardKind): PipelineNode {
  const node = newCard(kind, 0)
  return { ...node, id }
}

describe('incidentDiagramNodeIds', () => {
  it('focuses parallel branches, their diagram, and bounded downstream output', () => {
    const nodes = [
      card('source', 'source'),
      card('parallel', 'parallel'),
      card('profile', 'profile'),
      card('impact', 'impact'),
      card('diagram', 'diagram'),
      card('validation', 'validation'),
      card('output', 'output'),
      card('monitor', 'monitor'),
    ]
    const edges: Edge[] = [
      { id: 'source-parallel', source: 'source', target: 'parallel' },
      { id: 'parallel-profile', source: 'parallel', target: 'profile' },
      { id: 'parallel-impact', source: 'parallel', target: 'impact' },
      { id: 'profile-diagram', source: 'profile', target: 'diagram' },
      { id: 'impact-diagram', source: 'impact', target: 'diagram' },
      { id: 'diagram-validation', source: 'diagram', target: 'validation' },
      { id: 'validation-output', source: 'validation', target: 'output' },
      { id: 'output-monitor', source: 'output', sourceHandle: 'feedback', target: 'monitor' },
    ]

    expect(new Set(incidentDiagramNodeIds('diagram', nodes, edges))).toEqual(new Set([
      'parallel', 'profile', 'impact', 'diagram', 'validation', 'output',
    ]))
  })

  it('returns an empty selection for an unknown diagram', () => {
    expect(incidentDiagramNodeIds('missing', [card('source', 'source')], [])).toEqual([])
  })
})
