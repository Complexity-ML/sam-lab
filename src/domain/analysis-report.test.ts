import { describe, expect, it } from 'vitest'
import { buildAnalysisReport } from './analysis-report'
import { loadPipelinePreset, newCard } from './pipeline'
import { collectRiskImpactOverview } from './risk-impact'

describe('analysis report', () => {
  it('keeps an unrelated DataHub privacy result out of the SAM license decision', () => {
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

    expect(report.scope).toBe('Software asset evidence not established')
    expect(report.summary).toContain('SAM makes no license decision')
    expect(report.summary).toContain('Catalog scan: 75/75 assets checked; 0 qualified as software-asset evidence.')
    expect(report.softwareAssets).toBe(0)
    expect(report.profiledSoftwareAssets).toBe(0)
    expect(report.softwareEvidenceGaps).toBe(0)
    expect(report.risks).toEqual([])
    expect(report.contextRisks[0]).toMatchObject({ title: 'Privacy Risk: order_details', severity: 'high', affectedAssets: 18, action: 'review then mask' })
    expect(report.limitations[0]).toContain('No qualified software inventory')
    expect(report.evidence).toEqual([])
  })

  it('presents a dataset privacy profile only as non-SAM governance context', () => {
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

    expect(report.scope).toBe('Software asset evidence not established')
    expect(report.summary).toContain('1 data-governance or non-SAM finding is retained separately as context.')
    expect(report.summary).toContain('Catalog scan: 2/75 assets checked; 0 qualified as software-asset evidence.')
    expect(report.risks).toEqual([])
    expect(report.contextRisks[0]).toMatchObject({ title: 'order_details privacy risk', sensitiveSignals: 18 })
    expect(report.contextRisks[0]?.detail).toBe('Host risk score 7: order_details: 18 sensitive field/tag signal(s).')
    expect(report.evidence).toEqual([])
    expect(report.limitations).toEqual(expect.arrayContaining([
      expect.stringContaining('excluded from the license decision'),
    ]))
  })

  it('separates every non-SAM signal exposed by the Risks panel from material SAM findings', () => {
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
    expect(report.risks).toEqual([])
    expect(report.contextRisks).toHaveLength(overview.items.length)
    expect(report.contextRisks.map((item) => item.kind)).toEqual(['risk', 'coverage-gap', 'impact'])
    expect(report.contextRisks.map((item) => item.title)).toContain('Risk coverage missing · Uncovered impact')
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
    expect(report.softwareAssets).toBe(1)
    expect(report.profiledSoftwareAssets).toBe(1)
    expect(report.softwareEvidenceGaps).toBe(0)
    expect(report.decisionFacts).toEqual(expect.arrayContaining([
      { label: 'Purchased seats', value: '300' },
      { label: 'Annual savings', value: 'USD 9,348' },
    ]))
    expect(report.risks[0]).toMatchObject({ title: 'Copilot reclamation risk', domain: 'governance', affectedAssets: 42 })
  })

  it('does not classify commerce product tables as software inventory coverage gaps', () => {
    const explorer = { ...newCard('explorer', 0), id: 'explorer' }
    explorer.data.exploration = {
      query: '*',
      total: 3,
      discovered: 3,
      inspected: 3,
      dataAudited: 0,
      dataAuditCoverageGaps: 3,
      dataAuditRemaining: 0,
      failed: 0,
      incidents: 0,
      governanceGaps: 3,
      concurrency: 2,
      state: 'complete',
      checkpointAt: '2026-07-27T00:00:00.000Z',
      datasets: ['product_categories', 'product_information', 'order_details'].map((name) => ({
        urn: `urn:li:dataset:${name}`,
        name,
        status: 'warning' as const,
        fieldCount: 10,
        dataAuditStatus: 'coverage_gap' as const,
        ownerCount: 0,
        upstreamCount: 0,
        downstreamCount: 0,
        issues: ['owner missing', 'tags missing'],
        fingerprint: name,
        capturedAt: '2026-07-27T00:00:00.000Z',
        expiresAt: '2026-07-27T00:05:00.000Z',
      })),
    }

    const overview = collectRiskImpactOverview([explorer], [])
    const report = buildAnalysisReport([explorer], overview)

    expect(overview.items).toEqual([])
    expect(report.softwareAssets).toBe(0)
    expect(report.softwareEvidenceGaps).toBe(0)
    expect(report.summary).toContain('0 qualified as software-asset evidence')
  })
})
