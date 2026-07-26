import { describe, expect, it } from 'vitest'
import { validatePipeline } from '../validation'
import { governanceProposalFixture } from '../test/fixtures/agent-proposals'
import { applyProposal, customerActivationEdges, customerActivationNodes, initialEdges as blankEdges, initialNodes as blankNodes, newCard, pruneOrphanedCards, prunePipelineGraph } from './pipeline'

const initialNodes = customerActivationNodes
const initialEdges = customerActivationEdges

describe('pipeline validation', () => {
  it('starts the production workbench blank', () => {
    expect(blankNodes).toEqual([])
    expect(blankEdges).toEqual([])
  })
  it('detects the unmasked PII path in the starter graph', () => {
    expect(validatePipeline(initialNodes, initialEdges).some((issue) => issue.id === 'sensitive-unprotected-customers-source-activation-output')).toBe(true)
  })

  it('clears the PII error after the reviewed agent proposal is applied', () => {
    const proposal = governanceProposalFixture(initialNodes, initialEdges)
    const next = applyProposal(initialNodes, initialEdges, proposal)
    expect(validatePipeline(next.nodes, next.edges).some((issue) => issue.id.startsWith('sensitive-unprotected-'))).toBe(false)
  })

  it('rejects lineage cycles', () => {
    const cyclic = [...initialEdges, { id: 'cycle', source: 'activation-output', target: 'customers-source' }]
    expect(validatePipeline(initialNodes, cyclic).some((issue) => issue.id === 'cycle')).toBe(true)
  })

  it('adapts the generated protection rule to the classified schema', () => {
    const phoneNodes = initialNodes.map((node) => node.id === 'customers-source'
      ? { ...node, data: { ...node.data, schema: [{ name: 'phone_number', type: 'string' as const, tags: ['Sensitive'] }] } }
      : node)
    const proposal = governanceProposalFixture(phoneNodes, initialEdges)
    expect(proposal.addedNodes[0].data.rule).toContain('phone_number')
    expect(proposal.addedNodes[0].data.rule).not.toContain('email')
  })

  it('requests review without changing the graph when MCP evidence is uncertain', () => {
    const proposal = governanceProposalFixture(initialNodes, initialEdges, true)
    expect(proposal.addedNodes).toEqual([])
    expect(proposal.removedEdgeIds).toEqual([])
    expect(proposal.updatedNodes[0].patch.kind).toBe('review')
  })

  it('removes a disconnected duplicate while preserving host starters and unique drafts', () => {
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, datahubUrn: 'urn:orders' } }
    const connectedProfile = { ...newCard('profile', 1), id: 'profile-connected', data: { ...newCard('profile', 1).data, datahubUrn: 'urn:orders' } }
    const duplicateProfile = { ...newCard('profile', 2), id: 'profile-orphan', data: { ...newCard('profile', 2).data, datahubUrn: 'urn:orders' } }
    const uniqueDraft = { ...newCard('review', 3), id: 'unique-draft' }
    const control = { ...newCard('control', 4), id: 'control' }
    const next = pruneOrphanedCards(
      [control, source, connectedProfile, duplicateProfile, uniqueDraft],
      [{ id: 'source-profile', source: source.id, target: connectedProfile.id }],
    )

    expect(next.map((node) => node.id)).toEqual(['control', 'source', 'profile-connected', 'unique-draft'])
  })

  it('removes an orphaned profile whose DataHub identity differs only by casing', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const connectedProfile = {
      ...newCard('profile', 1),
      id: 'profile-connected',
      data: { ...newCard('profile', 1).data, assetRef: 'urn:li:dataset:(urn:li:dataPlatform:dbt,ORDER_DETAILS,PROD)' },
    }
    const orphanProfile = {
      ...newCard('profile', 2),
      id: 'profile-orphan',
      data: { ...newCard('profile', 2).data, assetRef: 'urn:li:dataset:(urn:li:dataPlatform:dbt,order_details,PROD)' },
    }
    const next = pruneOrphanedCards([source, connectedProfile, orphanProfile], [{ id: 'source-profile', source: source.id, target: connectedProfile.id }])
    expect(next.map((node) => node.id)).toEqual(['source', 'profile-connected'])
  })

  it('preserves reusable committed and manual profile sidecars when they do not overlap the branch', () => {
    const committedBase = newCard('profile', 0)
    const draftBase = newCard('profile', 1)
    const committed = {
      ...committedBase,
      id: 'committed-orphan',
      data: { ...committedBase.data, assetRef: 'urn:committed', status: 'healthy' as const },
    }
    const draft = {
      ...draftBase,
      id: 'manual-draft',
      data: { ...draftBase.data, assetRef: 'urn:draft', status: 'draft' as const },
    }

    expect(pruneOrphanedCards([committed, draft], []).map((node) => node.id)).toEqual(['committed-orphan', 'manual-draft'])
  })

  it('does not silently remove a newly bound Source before a later iteration connects it', () => {
    const source = { ...newCard('source', 0), id: 'license-source' }
    const profile = { ...newCard('profile', 1), id: 'license-profile' }
    const next = applyProposal([], [], {
      id: 'bind-source',
      title: 'Bind license source',
      summary: 'Preserve bounded evidence.',
      rationale: 'The next iteration will connect and analyze it.',
      addedNodes: [source, profile],
      updatedNodes: [],
      addedEdges: [],
      removedEdgeIds: [],
      datahubReads: [],
      writeback: 'none',
    })

    expect(next.nodes.map((node) => node.id)).toEqual(['license-source', 'license-profile'])
  })

  it('removes a stale profile reconstructed under a connected card and every dangling edge', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile' }
    const orphan = {
      ...newCard('profile', 2),
      id: 'orphan',
      position: { ...profile.position },
      data: { ...newCard('profile', 2).data, status: 'healthy' as const },
    }
    const graph = prunePipelineGraph(
      [source, profile, orphan],
      [
        { id: 'valid', source: source.id, target: profile.id },
        { id: 'dangling-from-orphan', source: orphan.id, target: 'missing' },
        { id: 'dangling-to-missing', source: profile.id, target: 'missing' },
      ],
    )

    expect(graph.nodes.map((node) => node.id)).toEqual(['source', 'profile'])
    expect(graph.edges.map((edge) => edge.id)).toEqual(['valid'])
  })
})
