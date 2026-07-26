import { describe, expect, it } from 'vitest'
import { buildAnalysisReport } from './analysis-report'
import { newCard } from './pipeline'

describe('analysis report', () => {
  it('turns catalog coverage and risk cards into a readable result', () => {
    const explorer = { ...newCard('explorer', 0), id: 'explorer' }
    explorer.data.exploration = {
      query: '',
      total: 75,
      discovered: 75,
      inspected: 75,
      dataAudited: 4,
      dataAuditCoverageGaps: 71,
      dataAuditRemaining: 0,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 4,
      state: 'complete',
      checkpointAt: '2026-07-26T21:10:00.000Z',
      datasets: [],
    }
    const source = { ...newCard('source', 1), id: 'source', data: { ...newCard('source', 1).data, label: 'order_details' } }
    const analysis = { ...newCard('analysis', 2), id: 'analysis', data: { ...newCard('analysis', 2).data, label: 'Classify evidence', description: 'Sensitive schema classification without a value anomaly claim.' } }
    const risk = {
      ...newCard('risk', 3),
      id: 'risk',
      data: {
        ...newCard('risk', 3).data,
        label: 'Privacy Risk: order_details',
        description: 'PII exposure requires governed review.',
        rule: 'scope=order_details | risk_domain=privacy | risk_type=data | severity=high | confidence=0.92 | evidence=fresh | affected_assets=18 | action=review_then_mask',
      },
    }

    const report = buildAnalysisReport([explorer, source, analysis, risk])

    expect(report.summary).toContain('75/75 catalog assets were inspected')
    expect(report.aggregateProfiles).toBe(4)
    expect(report.coverageGaps).toBe(71)
    expect(report.risks[0]).toMatchObject({ title: 'Privacy Risk: order_details', severity: 'high', affectedAssets: 18, action: 'review then mask' })
    expect(report.limitations[0]).toContain('71 catalog assets')
    expect(report.evidence[0]).toMatchObject({ title: 'Classify evidence', kind: 'analysis' })
  })
})
