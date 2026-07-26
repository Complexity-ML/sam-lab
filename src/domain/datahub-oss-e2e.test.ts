import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import mcpEvidence from '../../examples/datahub-oss/mcp-evidence.json'
import correctionFixture from '../../examples/datahub-oss/reviewed-correction.json'
import reviewedPipeline from '../../examples/datahub-oss/reviewed-pipeline.json'
import validationReport from '../../examples/datahub-oss/validation-report.json'
import { validateProposal } from '../../electron/proposal-contract'
import { validatePipeline } from '../validation'
import { materializeAiProposal, type AiProposalResponse } from './ai'
import { executePipelineAtomically } from './atomic-execution'
import { applyProposal, type PipelineNode } from './pipeline'
import { parsePipelineExport } from './pipeline-io'

const sourceUrn = 'urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_details,PROD)'
const initialNodes: PipelineNode[] = [
  {
    id: 'order-details-source',
    type: 'pipeline',
    position: { x: 80, y: 120 },
    data: {
      kind: 'source',
      label: 'order_details',
      description: 'DataHub-bound dbt dataset containing order and customer fields.',
      owner: 'Data Governance',
      status: 'healthy',
      datahubUrn: sourceUrn,
      datahubPlatform: 'dbt',
      datahubEnvironment: 'PROD',
      datahubTags: ['PII'],
      datahubQuality: 'healthy',
      schema: [
        { name: 'cust_email', type: 'string', tags: ['PII'] },
        { name: 'phone_number', type: 'string', tags: ['PII'] },
        { name: 'order_id', type: 'number' },
      ],
    },
  },
  {
    id: 'analytics-output',
    type: 'pipeline',
    position: { x: 420, y: 120 },
    data: {
      kind: 'output',
      label: 'Analytics consumers',
      description: 'Unprotected downstream analytics output.',
      owner: 'Analytics Engineering',
      status: 'blocked',
      schema: [],
    },
  },
]
const initialEdges: Edge[] = [{ id: 'e-source-output', source: 'order-details-source', target: 'analytics-output', type: 'elastic' }]

describe('DataHub OSS end-to-end acceptance fixture', () => {
  it('records successful real MCP reads without raw rows, credentials, or mutations', () => {
    expect(mcpEvidence.source.urn).toBe(sourceUrn)
    expect(mcpEvidence.requiredTools).toEqual({ get_entities: 'ok', list_schema_fields: 'ok', get_lineage: 'ok' })
    expect(mcpEvidence.findings.fieldCount).toBe(40)
    expect(mcpEvidence.findings.piiFields).toContain('cust_email')
    expect(mcpEvidence.findings.downstreamCount).toBeGreaterThan(0)
    expect(mcpEvidence.safety).toMatchObject({ mutationToolsEnabled: false, rawRowsCaptured: false, credentialsCaptured: false })
  })

  it('materializes the reviewed correction and completes only after atomic Human Review', () => {
    expect(validatePipeline(initialNodes, initialEdges).map((finding) => finding.id)).toContain('sensitive-unprotected-order-details-source-analytics-output')

    const payload = { graph: { nodes: initialNodes, edges: initialEdges } }
    const contract = validateProposal(correctionFixture.proposal, payload)
    const proposal = materializeAiProposal({ proposal: contract, model: 'deterministic-acceptance-fixture' } as AiProposalResponse, initialNodes, initialEdges)
    const approvedGraph = applyProposal(initialNodes, initialEdges, proposal)
    const blocking = validatePipeline(approvedGraph.nodes, approvedGraph.edges).filter((finding) => finding.severity === 'error')
    const review = approvedGraph.nodes.find((node) => node.data.kind === 'review')

    expect(proposal.removedEdgeIds).toContain('e-source-output')
    expect(approvedGraph.nodes.some((node) => node.data.kind === 'profile')).toBe(true)
    expect(approvedGraph.nodes.some((node) => node.data.kind === 'impact')).toBe(true)
    expect(approvedGraph.nodes.some((node) => node.data.kind === 'transform' && /mask|tokenize|sha256/i.test(`${node.data.label} ${node.data.rule}`))).toBe(true)
    expect(review).toBeDefined()
    expect(blocking).toEqual([])
    expect(executePipelineAtomically(approvedGraph.nodes, approvedGraph.edges).state).toBe('waiting')
    expect(executePipelineAtomically(approvedGraph.nodes, approvedGraph.edges, { reviewDecisions: { [review!.id]: 'approved' } }).state).toBe('completed')
    expect(executePipelineAtomically(approvedGraph.nodes, approvedGraph.edges, { reviewDecisions: { [review!.id]: 'rejected' } }).state).toBe('failed')
    expect(validationReport).toMatchObject({
      initial: { blockingIssues: 1 },
      candidateAfterReviewedDiff: { blockingIssues: 0, directUnprotectedEdgePresent: false },
      atomicReplay: { beforeHumanDecision: 'waiting', afterApproval: 'completed', afterRejection: 'failed' },
    })
  })

  it('ships an importable reviewed pipeline with committed DataHub evidence provenance', () => {
    const artifact = parsePipelineExport(JSON.stringify(reviewedPipeline))
    const blocking = validatePipeline(artifact.graph.nodes, artifact.graph.edges).filter((finding) => finding.severity === 'error')
    const version = artifact.versions[0]

    expect(artifact.projectTitle).toBe('Order details PII protection')
    expect(artifact.graph.nodes.map((node) => node.data.kind)).toEqual(expect.arrayContaining(['source', 'profile', 'impact', 'transform', 'review', 'output']))
    expect(blocking).toEqual([])
    expect(version.status).toBe('committed')
    expect(version.blockingIssues).toBe(0)
    expect(version.evidence?.map((item) => item.tool)).toEqual(['get_entities', 'list_schema_fields', 'get_lineage'])
  })
})
