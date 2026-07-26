import { describe, expect, it } from 'vitest'
import { newCard } from './pipeline'
import { collectRiskImpactOverview, riskItemsForDomain } from './risk-impact'

describe('impact and risk overview', () => {
  it('reports an uncovered Impact Analysis as coverage without inflating confirmed risks', () => {
    const impact = {
      ...newCard('impact', 0),
      id: 'impact',
      data: { ...newCard('impact', 0).data, label: 'Churn model impact', description: 'Training feature drift.' },
    }
    const overview = collectRiskImpactOverview([impact], [])

    expect(overview).toMatchObject({ actionable: 0, needsVerification: 0, coverageGaps: 1 })
    expect(overview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'coverage-gap', domain: 'ml', nodeId: 'impact' }),
    ]))
  })

  it('removes the coverage gap when the Impact reaches a Risk Assessment', () => {
    const impact = { ...newCard('impact', 0), id: 'impact' }
    const risk = {
      ...newCard('risk', 1),
      id: 'risk',
      data: {
        ...newCard('risk', 1).data,
        rule: 'scope=customer_dashboard | risk_domain=analytics | risk_type=data | severity=high | confidence=0.9 | evidence=fresh | affected_assets=2 | action=verify_metrics',
      },
    }
    const overview = collectRiskImpactOverview([impact, risk], [{ id: 'impact-risk', source: 'impact', target: 'risk' }])

    expect(overview).toMatchObject({ actionable: 1, high: 1, coverageGaps: 0 })
    expect(riskItemsForDomain(overview, 'analytics')).toEqual([
      expect.objectContaining({ kind: 'risk', nodeId: 'risk', domain: 'analytics' }),
    ])
  })

  it('reports software evidence quality and ownership gaps while ignoring unrelated PII', () => {
    const explorer = {
      ...newCard('explorer', 0),
      id: 'explorer',
      data: {
        ...newCard('explorer', 0).data,
        exploration: {
          query: '*',
          total: 3,
          discovered: 3,
          inspected: 3,
          failed: 0,
          incidents: 1,
          governanceGaps: 1,
          concurrency: 4,
          state: 'complete' as const,
          checkpointAt: '2026-07-24T20:00:00.000Z',
          datasets: [
            {
              urn: 'urn:li:dataset:quality',
              name: 'license_utilization',
              status: 'warning' as const,
              fieldCount: 12,
              sensitiveSignalCount: 0,
              qualityStatus: 'failing' as const,
              ownerCount: 1,
              upstreamCount: 1,
              downstreamCount: 2,
              issues: ['quality failing'],
              fingerprint: 'quality',
              capturedAt: '2026-07-24T20:00:00.000Z',
              expiresAt: '2026-07-24T20:05:00.000Z',
            },
            {
              urn: 'urn:li:dataset:sensitive',
              name: 'customers',
              status: 'healthy' as const,
              fieldCount: 8,
              sensitiveSignalCount: 3,
              qualityStatus: 'healthy' as const,
              ownerCount: 1,
              upstreamCount: 0,
              downstreamCount: 4,
              issues: [],
              fingerprint: 'sensitive',
              capturedAt: '2026-07-24T20:00:00.000Z',
              expiresAt: '2026-07-24T20:05:00.000Z',
            },
            {
              urn: 'urn:li:dataset:governance',
              name: 'software_contracts',
              status: 'warning' as const,
              fieldCount: 2,
              sensitiveSignalCount: 0,
              qualityStatus: 'healthy' as const,
              ownerCount: 1,
              upstreamCount: 0,
              downstreamCount: 0,
              issues: ['tags missing'],
              fingerprint: 'governance',
              capturedAt: '2026-07-24T20:00:00.000Z',
              expiresAt: '2026-07-24T20:05:00.000Z',
            },
          ],
        },
      },
    }

    const overview = collectRiskImpactOverview([explorer], [])

    expect(overview).toMatchObject({ actionable: 1, needsVerification: 0, high: 1, coverageGaps: 1 })
    expect(overview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'risk', domain: 'reliability', sourceRef: 'urn:li:dataset:quality' }),
      expect.objectContaining({ kind: 'coverage-gap', domain: 'governance', affectedAssets: 1 }),
    ]))
    expect(overview.items.some((item) => item.domain === 'privacy')).toBe(false)
    const classificationCoverage = overview.items.find((item) => item.title === 'Software inventory classification incomplete')
    expect(classificationCoverage).toMatchObject({
      severity: 'medium',
      evidence: 'catalog_checkpoint:incomplete_governance',
    })
    expect(classificationCoverage).not.toHaveProperty('sourceRef')
  })

  it('turns software profile anomalies into license analytics risk without privacy or ML drift', () => {
    const explorer = {
      ...newCard('explorer', 0),
      id: 'explorer',
      data: {
        ...newCard('explorer', 0).data,
        exploration: {
          query: '*',
          total: 1,
          discovered: 1,
          inspected: 1,
          failed: 0,
          incidents: 1,
          governanceGaps: 0,
          concurrency: 1,
          state: 'complete' as const,
          checkpointAt: '2026-07-24T20:00:00.000Z',
          datasets: [{
            urn: 'urn:li:dataset:training',
            name: 'license_usage',
            status: 'warning' as const,
            fieldCount: 8,
            sensitiveSignalCount: 2,
            qualityStatus: 'unavailable' as const,
            dataProfileStatus: 'available' as const,
            dataRiskSignals: [{
              id: 'null_spike:label',
              kind: 'null_spike' as const,
              severity: 'high' as const,
              field: 'label',
              summary: 'label null rate increased by 35 percentage points.',
              current: 0.4,
              previous: 0.05,
            }],
            ownerCount: 1,
            upstreamCount: 1,
            downstreamCount: 2,
            downstreamMlCount: 2,
            downstreamMlRefs: [
              { urn: 'urn:li:mlFeature:customer_label', name: 'customer_label', kind: 'feature' as const },
              { urn: 'urn:li:mlModel:churn_v3', name: 'churn_v3', kind: 'model' as const },
            ],
            issues: ['data-risk:null_spike:label'],
            fingerprint: 'training-null-spike',
            capturedAt: '2026-07-24T20:00:00.000Z',
            expiresAt: '2026-07-24T20:05:00.000Z',
          }],
        },
      },
    }

    const overview = collectRiskImpactOverview([explorer], [])

    expect(overview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'risk',
        domain: 'analytics',
        severity: 'high',
        sourceRef: 'urn:li:dataset:training',
        evidence: 'dataset_profile:two_version_aggregate',
      }),
    ]))
    expect(overview.items.some((item) => item.domain === 'privacy' || item.domain === 'ml')).toBe(false)
  })

  it('groups repeated governance gaps instead of producing one risk per dataset', () => {
    const explorer = {
      ...newCard('explorer', 0),
      id: 'explorer',
      data: {
        ...newCard('explorer', 0).data,
        exploration: {
          query: '*',
          total: 3,
          discovered: 3,
          inspected: 3,
          failed: 0,
          incidents: 0,
          governanceGaps: 3,
          concurrency: 1,
          state: 'complete' as const,
          checkpointAt: '2026-07-24T20:00:00.000Z',
          datasets: ['software_contracts', 'license_assignments', 'subscription_products'].map((name, index) => ({
            urn: `urn:li:dataset:${name}`,
            name,
            status: 'warning' as const,
            fieldCount: 3,
            sensitiveSignalCount: 0,
            qualityStatus: 'healthy' as const,
            ownerCount: index === 0 ? 0 : 1,
            upstreamCount: 0,
            downstreamCount: 0,
            issues: index === 0 ? ['owner missing', 'tags missing'] : ['tags missing'],
            fingerprint: name,
            capturedAt: '2026-07-24T20:00:00.000Z',
            expiresAt: '2026-07-24T20:05:00.000Z',
          })),
        },
      },
    }

    const overview = collectRiskImpactOverview([explorer], [])

    expect(overview).toMatchObject({
      actionable: 0,
      needsVerification: 0,
      coverageGaps: 2,
    })
    expect(overview.items.filter((item) => item.kind === 'coverage-gap')).toEqual([
      expect.objectContaining({ title: 'Software ownership coverage incomplete', affectedAssets: 1 }),
      expect.objectContaining({ title: 'Software inventory classification incomplete', affectedAssets: 3 }),
    ])
  })
})
