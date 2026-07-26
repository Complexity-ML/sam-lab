import { describe, expect, it } from 'vitest'
import { addDataProfileToProposal, canReuseDataProfile, createDataProfileSnapshot, dataProfileEvidence, isDataProfileFresh, isHostVerifiedAggregateDataProfile, isHostVerifiedMetadataOnlyProfile } from './data-profile'
import { compactGraph } from './ai'
import type { DataHubAssetSummary } from './datahub'
import type { AgentProposal } from './pipeline'

const asset: DataHubAssetSummary = {
  urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)',
  name: 'customers', platform: 'snowflake', environment: 'PROD', description: 'Customers', owners: [], domain: 'Growth', tags: ['PII'], qualityStatus: 'failing', upstream: [], downstream: [{ urn: 'downstream', name: 'activation', sensitive: true }],
  fields: Array.from({ length: 40 }, (_, index) => ({ name: `field_${index}`, type: 'string' as const, tags: index === 0 ? ['PII'] : undefined })),
  freshness: { capturedAt: '2026-07-22T10:00:00.000Z', expiresAt: '2099-07-22T11:00:00.000Z', stale: false },
}

const profiledAsset: DataHubAssetSummary = {
  ...asset,
  dataProfile: {
    status: 'available',
    capturedAt: '2026-07-22T10:00:00.000Z',
    previousCapturedAt: '2026-07-21T10:00:00.000Z',
    rowCount: 900,
    previousRowCount: 1_000,
    fields: [{
      name: 'field_0',
      nullRate: 0.3,
      previousNullRate: 0.1,
      distinctCount: 800,
      uniqueProportion: 0.89,
      previousUniqueProportion: 0.9,
    }],
    risks: [{
      id: 'null-spike-field-0',
      kind: 'null_spike',
      severity: 'high',
      field: 'field_0',
      summary: 'Null rate increased from 10% to 30%.',
      current: 0.3,
      previous: 0.1,
    }],
  },
}

function proposal(): AgentProposal {
  return { id: 'proposal', title: 'Profile', summary: 'Profile', rationale: 'Profile', addedNodes: [], updatedNodes: [], addedEdges: [], removedEdgeIds: [], datahubReads: [], writeback: 'Record profile.' }
}

describe('bounded data profile memory', () => {
  it('stores compact metadata without raw rows and reports anomalies', () => {
    const profile = createDataProfileSnapshot(asset)
    expect(profile.profiledFields).toHaveLength(32)
    expect(profile.fieldCount).toBe(40)
    expect(profile.sensitiveFieldCount).toBe(1)
    expect(profile.anomalies).toEqual(expect.arrayContaining(['No accountable owner is recorded.', 'DataHub quality checks are failing.']))
    expect(profile.storage).toEqual({ kind: 'bounded-metadata', version: 1, rawRowsStored: false, hostVerified: true })
    expect(profile.aggregateAudit).toMatchObject({ status: 'coverage_gap', rawRowsRead: false, hostVerified: true })
    expect(isHostVerifiedAggregateDataProfile(profile)).toBe(false)
    expect(isHostVerifiedMetadataOnlyProfile(profile)).toBe(true)
    expect(Object.hasOwn(profile, 'rawRows')).toBe(false)
    expect(profile.tokenEstimate).toBeGreaterThan(0)
    expect(isDataProfileFresh(profile)).toBe(true)
    expect(canReuseDataProfile(profile, false)).toBe(true)
    expect(canReuseDataProfile(profile, true)).toBe(false)
  })

  it('stores a host-verified aggregate dataset audit without raw values', () => {
    const profile = createDataProfileSnapshot(profiledAsset)
    expect(profile.aggregateAudit).toMatchObject({
      status: 'complete',
      rowCount: 900,
      previousRowCount: 1_000,
      profiledFieldCount: 1,
      rawRowsRead: false,
      hostVerified: true,
      riskSignals: [expect.objectContaining({ kind: 'null_spike', field: 'field_0', severity: 'high' })],
    })
    expect(isHostVerifiedAggregateDataProfile(profile)).toBe(true)
    expect(Object.hasOwn(profile, 'rawRows')).toBe(false)
    expect(isHostVerifiedAggregateDataProfile({
      ...profile,
      aggregateAudit: { ...profile.aggregateAudit, hostVerified: false },
    })).toBe(false)
  })

  it('rejects a claimed metadata-only profile when raw samples or untrusted proof are present', () => {
    const profile = createDataProfileSnapshot(asset)
    expect(isHostVerifiedMetadataOnlyProfile({ ...profile, sampleRows: [{ email: 'person@example.com' }] })).toBe(false)
    expect(isHostVerifiedMetadataOnlyProfile({ ...profile, storage: { ...profile.storage, hostVerified: false } })).toBe(false)
  })

  it('adds one sidecar profile card and reuses it as compact evidence', () => {
    const next = proposal()
    addDataProfileToProposal(next, [], asset)
    addDataProfileToProposal(next, [], asset)
    expect(next.addedNodes).toHaveLength(1)
    expect(next.addedNodes[0]).toMatchObject({ data: { kind: 'profile', pinned: true, profile: { sourceUrn: asset.urn } } })
    expect(dataProfileEvidence(next.addedNodes[0].data.profile!).evidence[0]).toMatchObject({ tool: 'data_profile_memory', cached: true })
  })

  it('replaces a duplicated source schema with a reference to fresh profile memory', () => {
    const next = proposal()
    addDataProfileToProposal(next, [], asset)
    const source = { id: 'source', type: 'pipeline' as const, position: { x: 0, y: 0 }, data: { kind: 'source' as const, label: 'Customers', description: '', owner: 'Data', status: 'healthy' as const, schema: asset.fields, datahubUrn: asset.urn } }
    const graph = compactGraph([source, next.addedNodes[0]], [])
    expect(graph.nodes[0]).toMatchObject({ profileRef: next.addedNodes[0].id, schema: [] })
    expect(graph.nodes[1].profile).toMatchObject({ fieldCount: 40, profiledFields: expect.any(Array) })
  })
})
