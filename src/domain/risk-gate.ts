import type { AutonomyPolicy } from './autonomy-policy'
import type { DataHubAssetSummary, DataHubEvidence } from './datahub'
import type { PipelineNode } from './pipeline'
import type { RiskEvidenceState, RiskSeverity, RiskType } from './risk-assessment'

export interface HostRiskDecision {
  riskType: RiskType
  severity: RiskSeverity
  confidence: number
  evidence: RiskEvidenceState
  affectedAssets: number
  score: number
  reasons: string[]
  requiresHumanReview: boolean
}

const sensitivePattern = /pii|sensitive|personal|gdpr|secret|credential/i

export function riskAssetsFromGraph(nodes: PipelineNode[]): DataHubAssetSummary[] {
  return nodes.flatMap((node) => {
    if (node.data.kind !== 'source') return []
    const urn = node.data.assetRef ?? node.data.datahubUrn
    if (!urn) return []
    return [{
      urn,
      assetRef: node.data.assetRef,
      connectorId: node.data.connectorId,
      sourceSystem: node.data.sourceSystem,
      name: node.data.label,
      platform: node.data.datahubPlatform ?? node.data.sourceSystem ?? 'unknown',
      environment: node.data.datahubEnvironment ?? 'unknown',
      description: node.data.description,
      owners: node.data.owner && node.data.owner !== 'Unassigned' ? [node.data.owner] : [],
      domain: node.data.datahubDomain,
      tags: node.data.datahubTags ?? [],
      fields: node.data.schema,
      qualityStatus: node.data.datahubQuality ?? node.data.profile?.quality ?? 'unavailable',
      upstream: node.data.datahubUpstream ?? [],
      downstream: node.data.datahubDownstream ?? [],
      freshness: node.data.datahubFreshness ?? {
        capturedAt: node.data.profile?.capturedAt ?? new Date(0).toISOString(),
        expiresAt: node.data.profile?.expiresAt ?? new Date(0).toISOString(),
        stale: node.data.profile?.stale ?? true,
      },
    }]
  })
}

function severityFor(score: number): RiskSeverity {
  if (score >= 9) return 'critical'
  if (score >= 6) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

/**
 * Deterministic host-side gate. The model may explain risk, but it cannot lower
 * the review decision derived from connector evidence.
 */
export function evaluateHostRisk(
  assets: DataHubAssetSummary[],
  evidence: DataHubEvidence[],
  policy: AutonomyPolicy,
): HostRiskDecision {
  const relevantEvidence = evidence.filter((read) => assets.length === 0 || assets.some((asset) => asset.urn === read.urn))
  const freshReads = relevantEvidence.filter((read) => read.status === 'ok' && !read.stale)
  const evidenceUnavailable = relevantEvidence.length > 0 && freshReads.length === 0
  const staleEvidence = relevantEvidence.some((read) => read.stale)

  if (evidenceUnavailable || staleEvidence || assets.some((asset) => asset.freshness.stale)) {
    const reasons = [
      ...(evidenceUnavailable ? ['Required connector evidence is unavailable.'] : []),
      ...(staleEvidence || assets.some((asset) => asset.freshness.stale) ? ['At least one evidence snapshot is stale.'] : []),
    ]
    return {
      riskType: 'collection',
      severity: evidenceUnavailable ? 'high' : 'medium',
      confidence: 1,
      evidence: evidenceUnavailable ? 'unavailable' : 'stale',
      affectedAssets: 0,
      score: evidenceUnavailable ? 6 : 4,
      reasons,
      requiresHumanReview: policy.uncertainty === 'review' || policy.humanReview !== 'critical-only',
    }
  }

  let score = 0
  let affectedAssets = 0
  const reasons: string[] = []
  for (const asset of assets) {
    const sensitiveFields = asset.fields.filter((field) => field.tags?.some((tag) => sensitivePattern.test(tag))).length
    const sensitiveTags = asset.tags.filter((tag) => sensitivePattern.test(tag)).length
    const sensitiveDownstream = asset.downstream.filter((item) => item.sensitive).length
    const lineageRadius = asset.upstream.length + asset.downstream.length

    if (asset.qualityStatus === 'failing') {
      score += 5
      reasons.push(`${asset.name}: quality checks are failing.`)
    } else if (asset.qualityStatus === 'unavailable') {
      score += 1
      reasons.push(`${asset.name}: quality metadata is unavailable.`)
    }
    if (!asset.owners.length) {
      score += 2
      reasons.push(`${asset.name}: no accountable owner is recorded.`)
    }
    if (sensitiveFields || sensitiveTags) {
      score += 3
      reasons.push(`${asset.name}: ${sensitiveFields || sensitiveTags} sensitive field/tag signal(s).`)
    }
    if (sensitiveDownstream) {
      score += 4
      reasons.push(`${asset.name}: ${sensitiveDownstream} sensitive downstream asset(s).`)
    }
    if (lineageRadius >= 20) score += 4
    else if (lineageRadius >= 5) score += 2
    else if (lineageRadius > 0) score += 1
    affectedAssets += lineageRadius
  }

  const severity = severityFor(score)
  const sensitive = reasons.some((reason) => reason.includes('sensitive'))
  const requiresHumanReview = policy.humanReview === 'frequent'
    || severity === 'critical'
    || severity === 'high'
    || (policy.humanReview === 'risk-based' && (sensitive || severity === 'medium'))

  return {
    riskType: assets.length ? 'data' : 'none',
    severity: assets.length ? severity : 'unknown',
    confidence: freshReads.length || assets.length ? 0.9 : 0,
    evidence: freshReads.length || assets.length ? 'fresh' : 'unavailable',
    affectedAssets,
    score,
    reasons: reasons.length ? reasons : ['No elevated evidence-backed risk signal was found.'],
    requiresHumanReview,
  }
}
