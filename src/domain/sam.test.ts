import { describe, expect, it } from 'vitest'
import { analyzeSoftwarePortfolio, sampleSoftwareAssets } from './sam'

describe('SAM portfolio analysis', () => {
  it('calculates bounded spend and recoverable license waste', () => {
    const metrics = analyzeSoftwarePortfolio(sampleSoftwareAssets, new Date('2026-07-26T00:00:00.000Z'))
    expect(metrics.assetCount).toBe(3)
    expect(metrics.annualSpend).toBe(246_720)
    expect(metrics.unusedSeats).toBe(29)
    expect(metrics.annualizedWaste).toBe(21_720)
  })

  it('separates compliance, security, renewal and usage findings', () => {
    const metrics = analyzeSoftwarePortfolio(sampleSoftwareAssets, new Date('2026-07-26T00:00:00.000Z'))
    expect(metrics.complianceExposureCount).toBe(2)
    expect(metrics.renewalExposureCount).toBe(2)
    expect(metrics.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'salesforce', domain: 'compliance', severity: 'critical' }),
      expect.objectContaining({ assetId: 'shadow-ai', domain: 'security', severity: 'high' }),
      expect.objectContaining({ assetId: 'figma', domain: 'renewal' }),
    ]))
  })
})
