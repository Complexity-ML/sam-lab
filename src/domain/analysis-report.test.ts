import { describe, expect, it } from 'vitest'
import { buildAnalysisReport } from './analysis-report'
import { loadPipelinePreset, newCard } from './pipeline'
import { collectRiskImpactOverview } from './risk-impact'

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

    expect(report.scope).toBe('order_details privacy analysis')
    expect(report.summary).toContain('Catalog coverage: 75/75 assets checked')
    expect(report.aggregateProfiles).toBe(4)
    expect(report.coverageGaps).toBe(71)
    expect(report.risks[0]).toMatchObject({ title: 'Privacy Risk: order_details', severity: 'high', affectedAssets: 18, action: 'review then mask' })
    expect(report.limitations[0]).toContain('71 catalog assets')
    expect(report.evidence[0]).toMatchObject({ title: 'Classify evidence', kind: 'analysis' })
  })

  it('distinguishes metadata profiles, catalog coverage and downstream impact', () => {
    const explorer = { ...newCard('explorer', 0), id: 'explorer' }
    explorer.data.exploration = {
      query: '',
      total: 75,
      discovered: 75,
      inspected: 2,
      dataAudited: 0,
      dataAuditCoverageGaps: 2,
      dataAuditRemaining: 73,
      failed: 0,
      incidents: 0,
      governanceGaps: 0,
      concurrency: 2,
      state: 'inspecting',
      checkpointAt: '2026-07-26T21:10:00.000Z',
      datasets: [],
    }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, label: 'order_details profile' } }
    const risk = {
      ...newCard('risk', 2),
      id: 'risk',
      data: {
        ...newCard('risk', 2).data,
        label: 'Host risk · HIGH',
        description: 'Evidence-backed risk preserved before mitigation. HIGH host risk score 7: order_details: 18 sensitive field/tag signal(s).',
        rule: 'scope=order_details | risk_domain=privacy | severity=high | confidence=0.9 | evidence=fresh | affected_assets=24 | action=human_review_then_apply_versioned_mitigation_and_verify',
      },
    }

    const report = buildAnalysisReport([explorer, profile, risk])

    expect(report.scope).toBe('order_details privacy analysis')
    expect(report.summary).toContain('order_details contains 18 sensitive field or tag signals.')
    expect(report.summary).toContain('covers 24 downstream assets')
    expect(report.summary).toContain('Aggregate evidence is unavailable')
    expect(report.summary).toContain('Human review and post-mitigation verification are required.')
    expect(report.summary).toContain('Catalog coverage: 2/75 assets checked.')
    expect(report.risks[0]).toMatchObject({ title: 'order_details privacy risk', sensitiveSignals: 18 })
    expect(report.risks[0]?.detail).toBe('Host risk score 7: order_details: 18 sensitive field/tag signal(s).')
    expect(report.evidence[0]).toMatchObject({ kind: 'profile', label: 'metadata profile' })
    expect(report.limitations[1]).toContain('schema metadata only')
  })

  it('includes every signal exposed by the Risks panel', () => {
    const impact = { ...newCard('impact', 0), id: 'impact', data: { ...newCard('impact', 0).data, label: 'Uncovered impact' } }
    const risk = {
      ...newCard('risk', 1),
      id: 'risk',
      data: { ...newCard('risk', 1).data, rule: 'scope=orders | risk_domain=privacy | severity=high | action=review_then_verify' },
    }
    const nodes = [impact, risk]
    const overview = collectRiskImpactOverview(nodes, [])
    const report = buildAnalysisReport(nodes, overview)

    expect(overview.items).toHaveLength(3)
    expect(report.risks).toHaveLength(overview.items.length)
    expect(report.risks.map((item) => item.kind)).toEqual(['risk', 'coverage-gap', 'impact'])
    expect(report.risks.map((item) => item.title)).toContain('Risk coverage missing · Uncovered impact')
  })

  it('explains the Copilot license decision with seats and annual savings', () => {
    const preset = loadPipelinePreset('license-reclamation')
    const overview = collectRiskImpactOverview(preset.nodes, preset.edges)
    const report = buildAnalysisReport(preset.nodes, overview)

    expect(report.scope).toBe('Copilot license utilization software asset analysis')
    expect(report.summary).toContain('300 purchased seats, 250 assigned and 178 active')
    expect(report.summary).toContain('42 seats require review')
    expect(report.summary).toContain('41 are eligible for reclamation')
    expect(report.summary).toContain('USD 9,348 in annual savings')
    expect(report.aggregateProfiles).toBe(1)
    expect(report.decisionFacts).toEqual(expect.arrayContaining([
      { label: 'Purchased seats', value: '300' },
      { label: 'Annual savings', value: 'USD 9,348' },
    ]))
    expect(report.risks[0]).toMatchObject({ title: 'Copilot reclamation risk', domain: 'governance', affectedAssets: 42 })
  })
})
