import { describe, expect, it } from 'vitest'
import { defaultAutonomyPolicy } from './autonomy-policy'
import type { DataHubAssetSummary, DataHubEvidence } from './datahub'
import { evaluateHostRisk } from './risk-gate'

const asset: DataHubAssetSummary = {
  urn: 'urn:customer',
  name: 'Customer features',
  platform: 'snowflake',
  environment: 'PROD',
  description: '',
  owners: ['ML Platform'],
  tags: [],
  fields: [{ name: 'email', type: 'string', tags: ['PII'] }],
  qualityStatus: 'healthy',
  upstream: [],
  downstream: [{ urn: 'urn:model', name: 'Churn model', sensitive: true }],
  freshness: { capturedAt: '2026-07-24T00:00:00.000Z', expiresAt: '2026-07-24T01:00:00.000Z', stale: false },
}

const evidence: DataHubEvidence[] = [{
  tool: 'get_lineage',
  urn: asset.urn,
  capturedAt: '2026-07-24T00:00:00.000Z',
  expiresAt: '2026-07-24T01:00:00.000Z',
  status: 'ok',
  summary: '1 downstream model',
  cached: false,
  stale: false,
}]

describe('deterministic host risk gate', () => {
  it('routes sensitive downstream impact through Human Review', () => {
    expect(evaluateHostRisk([asset], evidence, defaultAutonomyPolicy)).toMatchObject({
      riskType: 'data',
      severity: 'high',
      evidence: 'fresh',
      requiresHumanReview: true,
    })
  })

  it('never presents unavailable collection evidence as dataset risk', () => {
    const unavailable = [{ ...evidence[0]!, status: 'error' as const, stale: true }]
    expect(evaluateHostRisk([asset], unavailable, defaultAutonomyPolicy)).toMatchObject({
      riskType: 'collection',
      severity: 'high',
      evidence: 'unavailable',
      affectedAssets: 0,
      requiresHumanReview: true,
    })
  })

  it('allows fresh low-risk evidence under critical-only policy', () => {
    const safe = { ...asset, fields: [], downstream: [], qualityStatus: 'healthy' as const }
    expect(evaluateHostRisk([safe], evidence, { ...defaultAutonomyPolicy, humanReview: 'critical-only' })).toMatchObject({
      severity: 'low',
      requiresHumanReview: false,
    })
  })
})
