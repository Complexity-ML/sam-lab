// @vitest-environment node

import type { Edge } from '@xyflow/react'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateProposal } from '../electron/proposal-contract'
import { materializeAiProposal, type AiProposalResponse } from '../src/domain/ai'
import { executePipelineAtomically } from '../src/domain/atomic-execution'
import { applyProposal, type PipelineNode } from '../src/domain/pipeline'
import { validatePipeline } from '../src/validation'

const artifactPath = process.env.DATA_LAB_PROVIDER_ARTIFACT
const artifact = artifactPath && existsSync(artifactPath) ? JSON.parse(readFileSync(artifactPath, 'utf8')) : undefined
const providerDescribe = artifact ? describe : describe.skip

providerDescribe('provider-backed DataHub OSS workflow artifact', () => {
  it('materializes the reviewed provider diff and passes the real atomic validators', () => {
    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.status).toMatch(/^approved-/)
    expect(artifact.provider).not.toContain('fixture')
    expect(artifact.disclosure).toMatchObject({ explicitlyConfirmed: true, rawRowsShared: false, credentialsShared: false })
    expect(artifact.mcp.requiredTools).toEqual({ get_entities: 'ok', list_schema_fields: 'ok', get_lineage: 'ok' })
    expect(artifact.mcp.safety).toMatchObject({ mutationToolsEnabled: false, rawRowsCaptured: false, credentialsCaptured: false })
    expect(artifact.review.decision).toBe('approved')

    const initialNodes = artifact.initialGraph.nodes as PipelineNode[]
    const initialEdges = artifact.initialGraph.edges as Edge[]
    const source = initialNodes.find((node) => node.id === 'order-details-source')!
    const contract = validateProposal(artifact.proposal, artifact.request)
    const proposal = materializeAiProposal({ proposal: contract, model: artifact.model } as AiProposalResponse, initialNodes, initialEdges)
    const approved = applyProposal(initialNodes, initialEdges, proposal)
    const review = approved.nodes.find((node) => node.data.kind === 'review')
    const sourceAfter = approved.nodes.find((node) => node.id === source.id)
    const blocking = validatePipeline(approved.nodes, approved.edges).filter((finding) => finding.severity === 'error')

    expect(proposal.removedEdgeIds).toContain('e-source-output')
    expect(approved.edges.some((edge) => edge.id === 'e-source-output')).toBe(false)
    expect(sourceAfter?.data.datahubUrn).toBe(source.data.datahubUrn)
    expect(approved.nodes.some((node) => node.data.kind === 'profile')).toBe(true)
    expect(approved.nodes.some((node) => node.data.kind === 'impact')).toBe(true)
    expect(approved.nodes.some((node) => node.data.kind === 'transform' && /mask|hash|sha(?:-?\d+)?|tokeni[sz]e|redact|encrypt/i.test(`${node.data.label} ${node.data.rule ?? ''}`))).toBe(true)
    expect(review).toBeDefined()
    expect(blocking).toEqual([])
    expect(executePipelineAtomically(approved.nodes, approved.edges).state).toBe('waiting')
    expect(executePipelineAtomically(approved.nodes, approved.edges, { reviewDecisions: { [review!.id]: 'approved' } }).state).toBe('completed')
  })
})
