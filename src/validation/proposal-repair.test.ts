import { describe, expect, it } from 'vitest'
import { applyProposal, newCard, type AgentProposal, type PipelineNode } from '../domain/pipeline'
import { validatePipeline } from '.'
import { repairMonitorWorkBranches, repairSensitiveOutputPaths } from './proposal-repair'

describe('proposal safety repair', () => {
  it('inserts a deterministic protection boundary before a sensitive output', () => {
    const source: PipelineNode = {
      ...newCard('source', 0),
      id: 'source',
      data: {
        ...newCard('source', 0).data,
        schema: [{ name: 'email', type: 'string' as const, tags: ['PII'] }],
      },
    }
    const output = { ...newCard('output', 1), id: 'output' }
    const proposal: AgentProposal = {
      id: 'proposal',
      title: 'Publish governed output',
      summary: 'Add the output.',
      rationale: 'The branch needs a terminal artifact.',
      requiresHumanReview: false,
      addedNodes: [output],
      updatedNodes: [],
      addedEdges: [{ id: 'source-output', source: source.id, target: output.id }],
      removedEdgeIds: [],
      datahubReads: [],
      writeback: '',
    }

    const repaired = repairSensitiveOutputPaths(proposal, [source], [])
    const graph = applyProposal([source], [], proposal)

    expect(repaired.repairedOutputs).toEqual(['output'])
    expect(proposal.requiresHumanReview).toBe(true)
    expect(graph.nodes.some((node) => node.data.kind === 'transform' && /mask|tokenize/i.test(node.data.rule ?? ''))).toBe(true)
    expect(validatePipeline(graph.nodes, graph.edges).some((finding) => finding.id.startsWith('sensitive-unprotected-'))).toBe(false)
  })

  it('connects a feedback monitor to the first replayable evidence card', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile' }
    const review = { ...newCard('review', 2), id: 'review' }
    const output = { ...newCard('output', 3), id: 'output' }
    const monitor = { ...newCard('monitor', 4), id: 'monitor' }
    const currentNodes = [source, profile, review, output]
    const currentEdges = [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-review', source: profile.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ]
    const proposal: AgentProposal = {
      id: 'monitor-proposal',
      title: 'Arm continuous monitoring',
      summary: 'Add one bounded monitor.',
      rationale: 'The reviewed output needs fresh-evidence verification.',
      requiresHumanReview: false,
      addedNodes: [monitor],
      updatedNodes: [],
      addedEdges: [{ id: 'output-monitor', source: output.id, sourceHandle: 'feedback', target: monitor.id }],
      removedEdgeIds: [],
      datahubReads: [],
      writeback: '',
    }

    expect(repairMonitorWorkBranches(proposal, currentNodes, currentEdges).repairedMonitors).toEqual(['monitor'])
    const graph = applyProposal(currentNodes, currentEdges, proposal)
    const blockerIds = validatePipeline(graph.nodes, graph.edges).map((finding) => finding.id)

    expect(graph.edges.some((edge) => edge.source === monitor.id && edge.target === profile.id)).toBe(true)
    expect(blockerIds).not.toContain('orphan-output-monitor')
    expect(blockerIds).not.toContain('monitor-output-monitor')
  })
})
