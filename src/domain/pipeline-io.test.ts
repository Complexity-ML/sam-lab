import { describe, expect, it } from 'vitest'
import { validatePipeline } from '../validation'
import { createDataProfileSnapshot } from './data-profile'
import type { DataHubAssetSummary } from './datahub'
import { customerActivationEdges, customerActivationNodes, newCard } from './pipeline'
import { createPipelineExport, parsePipelineExport } from './pipeline-io'

describe('versioned pipeline JSON exchange', () => {
  it('round-trips graph metadata while excluding secrets, encrypted blobs and local paths', () => {
    const nodes = customerActivationNodes.map((node, index) => index ? node : ({ ...node, data: { ...node.data, apiKey: 'secret', encryptedKey: 'blob', localPath: '/Users/person/private' } }))
    const exported = createPipelineExport('Customer activation', nodes, customerActivationEdges, [])
    const serialized = JSON.stringify(exported)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('encryptedKey')
    expect(serialized).not.toContain('/Users/person')
    expect(parsePipelineExport(serialized).graph.nodes).toHaveLength(nodes.length)
  })

  it('rejects unsupported schema versions before returning a graph', () => {
    expect(() => parsePipelineExport(JSON.stringify({ schema: 'sam-lab.pipeline', schemaVersion: 99, graph: { nodes: [], edges: [] } }))).toThrow('Unsupported SAM LAB schema version 99')
  })

  it('rejects dangling imports instead of partially changing the workspace', () => {
    const value = createPipelineExport('Broken', [], [], [])
    value.graph.edges.push({ id: 'dangling', source: 'missing', target: 'also-missing' })
    expect(() => parsePipelineExport(JSON.stringify(value))).toThrow('references a missing card')
  })

  it('round-trips a bounded generic Worker Node', () => {
    const worker = { ...newCard('worker', 0), id: 'worker-audit' }
    const imported = parsePipelineExport(JSON.stringify(createPipelineExport('Worker policy', [worker], [], [])))
    expect(imported.graph.nodes[0]?.data).toMatchObject({
      kind: 'worker',
      workerMode: 'bounded-execution',
      rule: 'role=generic | batch_size=4 | max_concurrency=4 | retry=checkpoint | max_retries=3 | cooldown_seconds=30 | context=branch_only | merge=atomic',
    })
  })

  it('does not trust an exported host proof after crossing the import boundary', () => {
    const asset: DataHubAssetSummary = {
      urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)',
      name: 'customers', platform: 'snowflake', environment: 'PROD', description: '', owners: ['Data Governance'], domain: '', tags: ['PII'], qualityStatus: 'healthy', upstream: [], downstream: [],
      fields: [{ name: 'email', type: 'string', tags: ['PII'] }],
      freshness: { capturedAt: '2026-07-24T10:00:00.000Z', expiresAt: '2099-07-24T11:00:00.000Z', stale: false },
    }
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, owner: 'Data Governance', schema: asset.fields, datahubTags: ['PII'] } }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: createDataProfileSnapshot(asset) } }
    const output = { ...newCard('output', 2), id: 'output' }
    const edges = [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-output', source: profile.id, target: output.id },
    ]
    const exported = createPipelineExport('Metadata boundary', [source, profile, output], edges, [])
    expect(exported.graph.nodes[1].data.profile?.storage.hostVerified).toBe(true)
    expect(exported.graph.nodes[1].data.profile?.aggregateAudit.hostVerified).toBe(true)

    const imported = parsePipelineExport(JSON.stringify(exported))
    expect(imported.graph.nodes[1].data.profile?.storage.hostVerified).toBe(false)
    expect(imported.graph.nodes[1].data.profile?.aggregateAudit.hostVerified).toBe(false)
    expect(validatePipeline(imported.graph.nodes, imported.graph.edges)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensitive-unprotected-source-output', severity: 'error' }),
    ]))
  })
  it('migrates a legacy failed catalog checkpoint into a resumable connector pause', () => {
    const explorer = newCard('explorer', 0)
    explorer.data.exploration = {
      query: '*',
      total: 67,
      discovered: 67,
      inspected: 8,
      failed: 5,
      incidents: 0,
      governanceGaps: 8,
      concurrency: 4,
      batchSize: 4,
      batchDurationMs: 7_500,
      batchFailed: 1,
      batchProcessed: 4,
      batchCached: 2,
      state: 'failed',
      checkpointAt: '2026-07-24T12:43:27.235Z',
      datasets: [],
    }

    const imported = parsePipelineExport(JSON.stringify(createPipelineExport('Catalog recovery', [explorer], [], [])))
    expect(imported.graph.nodes[0]!.data.exploration).toMatchObject({
      state: 'paused',
      pauseReason: 'connector_unavailable',
      batchSize: 4,
      batchDurationMs: 7_500,
      batchFailed: 1,
      batchProcessed: 4,
      batchCached: 2,
      inspected: 8,
      failed: 5,
    })
  })

  it('preserves custom catalog identity and structured SAM evidence across JSON import', () => {
    const customAsset: DataHubAssetSummary = {
      connectorId: 'catalog-a',
      sourceSystem: 'Catalog A',
      assetRef: 'software/licenses',
      urn: 'software/licenses',
      name: 'Software licenses',
      platform: 'http-api',
      environment: 'PROD',
      description: 'Aggregate software license evidence',
      owners: ['ITAM'],
      tags: ['SAM'],
      qualityStatus: 'healthy',
      fields: [{ name: 'purchased_seats', type: 'number' }],
      upstream: [],
      downstream: [],
      freshness: { capturedAt: '2026-07-24T10:00:00.000Z', expiresAt: '2099-07-24T11:00:00.000Z', stale: false },
    }
    const source = newCard('source', 0)
    source.data.connectorId = customAsset.connectorId
    source.data.sourceSystem = customAsset.sourceSystem
    source.data.assetRef = customAsset.assetRef
    source.data.profile = createDataProfileSnapshot(customAsset)
    source.data.samAsset = {
      id: 'product-a',
      product: 'Product A',
      vendor: 'Vendor A',
      owner: 'ITAM',
      purchasedSeats: 20,
      assignedSeats: 18,
      activeSeats: 12,
      annualUnitCost: 100,
      complianceStatus: 'compliant',
      approved: true,
    }
    const explorer = newCard('explorer', 1)
    explorer.data.exploration = {
      query: 'license',
      total: 1,
      discovered: 1,
      inspected: 1,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 1,
      state: 'complete',
      checkpointAt: '2026-07-24T10:00:00.000Z',
      datasets: [{
        connectorId: customAsset.connectorId,
        sourceSystem: customAsset.sourceSystem,
        assetRef: customAsset.assetRef,
        urn: customAsset.urn,
        name: customAsset.name,
        status: 'healthy',
        fieldCount: 1,
        ownerCount: 1,
        upstreamCount: 0,
        downstreamCount: 0,
        issues: [],
        fingerprint: 'catalog-a-license',
        capturedAt: customAsset.freshness.capturedAt,
        expiresAt: customAsset.freshness.expiresAt,
      }],
    }

    const imported = parsePipelineExport(JSON.stringify(createPipelineExport('Custom catalog', [source, explorer], [], [])))

    expect(imported.graph.nodes[0]?.data).toMatchObject({
      connectorId: 'catalog-a',
      assetRef: 'software/licenses',
      profile: { connectorId: 'catalog-a', assetRef: 'software/licenses', sourceUrn: 'software/licenses' },
      samAsset: { product: 'Product A', purchasedSeats: 20, activeSeats: 12 },
    })
    expect(imported.graph.nodes[1]?.data.exploration?.datasets[0]).toMatchObject({
      connectorId: 'catalog-a',
      assetRef: 'software/licenses',
      urn: 'software/licenses',
    })
  })
})
