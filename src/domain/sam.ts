export type SamComplianceStatus = 'compliant' | 'attention' | 'non-compliant' | 'unknown'
export type SamRiskDomain = 'license' | 'cost' | 'usage' | 'compliance' | 'security' | 'renewal'

export interface SoftwareAsset {
  id: string
  product: string
  vendor: string
  owner: string
  purchasedSeats: number
  assignedSeats: number
  activeSeats: number
  annualUnitCost: number
  renewalDate?: string
  complianceStatus: SamComplianceStatus
  approved: boolean
}

export interface SamFinding {
  assetId: string
  domain: SamRiskDomain
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  evidence: string
  recommendedAction: string
}

export interface SamPortfolioMetrics {
  assetCount: number
  annualSpend: number
  unusedSeats: number
  annualizedWaste: number
  complianceExposureCount: number
  renewalExposureCount: number
  findings: SamFinding[]
}

const money = (value: number) => Math.round(value * 100) / 100

export function analyzeSoftwarePortfolio(assets: SoftwareAsset[], referenceDate = new Date()): SamPortfolioMetrics {
  const referenceTime = referenceDate.getTime()
  const renewalWindowEnd = referenceTime + 90 * 24 * 60 * 60 * 1_000
  const findings: SamFinding[] = []
  let annualSpend = 0
  let unusedSeats = 0
  let annualizedWaste = 0
  let complianceExposureCount = 0
  let renewalExposureCount = 0

  for (const asset of assets) {
    const purchased = Math.max(0, asset.purchasedSeats)
    const assigned = Math.max(0, asset.assignedSeats)
    const active = Math.max(0, asset.activeSeats)
    const unused = Math.max(0, purchased - active)
    const spend = purchased * Math.max(0, asset.annualUnitCost)
    const waste = unused * Math.max(0, asset.annualUnitCost)
    annualSpend += spend
    unusedSeats += unused
    annualizedWaste += waste

    if (unused > 0) findings.push({
      assetId: asset.id,
      domain: 'usage',
      severity: unused / Math.max(1, purchased) >= 0.3 ? 'high' : 'medium',
      title: `${unused} unused ${asset.product} license${unused === 1 ? '' : 's'}`,
      evidence: `${active}/${purchased} purchased seats were active in the bounded usage snapshot.`,
      recommendedAction: 'Review assignments, then reclaim or downgrade inactive seats.',
    })

    if (assigned > purchased || asset.complianceStatus === 'non-compliant') {
      complianceExposureCount += 1
      findings.push({
        assetId: asset.id,
        domain: 'compliance',
        severity: assigned > purchased ? 'critical' : 'high',
        title: `${asset.product} entitlement exposure`,
        evidence: `${assigned} assigned seats for ${purchased} purchased; status=${asset.complianceStatus}.`,
        recommendedAction: 'Verify entitlement evidence and obtain owner approval before remediation.',
      })
    } else if (asset.complianceStatus === 'attention' || asset.complianceStatus === 'unknown') {
      complianceExposureCount += 1
      findings.push({
        assetId: asset.id,
        domain: 'compliance',
        severity: 'medium',
        title: `${asset.product} requires compliance evidence`,
        evidence: `Recorded compliance status is ${asset.complianceStatus}.`,
        recommendedAction: 'Attach the contract, invoice or entitlement record and re-run the check.',
      })
    }

    if (!asset.approved) findings.push({
      assetId: asset.id,
      domain: 'security',
      severity: 'high',
      title: `${asset.product} is not approved`,
      evidence: 'The normalized inventory does not contain an approved application record.',
      recommendedAction: 'Escalate to the software owner and security review before continued use.',
    })

    if (asset.renewalDate) {
      const renewalTime = new Date(asset.renewalDate).getTime()
      if (Number.isFinite(renewalTime) && renewalTime >= referenceTime && renewalTime <= renewalWindowEnd) {
        renewalExposureCount += 1
        findings.push({
          assetId: asset.id,
          domain: 'renewal',
          severity: waste > 0 ? 'high' : 'medium',
          title: `${asset.product} renews within 90 days`,
          evidence: `Renewal ${asset.renewalDate}; annual spend ${money(spend)}; recoverable waste ${money(waste)}.`,
          recommendedAction: 'Review utilization and owner intent before the renewal deadline.',
        })
      }
    }
  }

  return {
    assetCount: assets.length,
    annualSpend: money(annualSpend),
    unusedSeats,
    annualizedWaste: money(annualizedWaste),
    complianceExposureCount,
    renewalExposureCount,
    findings,
  }
}

export const sampleSoftwareAssets: SoftwareAsset[] = [
  { id: 'figma', product: 'Figma', vendor: 'Figma', owner: 'Design', purchasedSeats: 40, assignedSeats: 38, activeSeats: 25, annualUnitCost: 180, renewalDate: '2026-09-15', complianceStatus: 'compliant', approved: true },
  { id: 'salesforce', product: 'Salesforce Sales Cloud', vendor: 'Salesforce', owner: 'Revenue Operations', purchasedSeats: 120, assignedSeats: 126, activeSeats: 111, annualUnitCost: 1_980, renewalDate: '2026-10-01', complianceStatus: 'non-compliant', approved: true },
  { id: 'shadow-ai', product: 'Unknown AI Assistant', vendor: 'Unknown', owner: 'Unassigned', purchasedSeats: 8, assignedSeats: 8, activeSeats: 3, annualUnitCost: 240, complianceStatus: 'unknown', approved: false },
]
