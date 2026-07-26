export type RiskType = 'data' | 'collection' | 'none'
export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'
export type RiskEvidenceState = 'fresh' | 'stale' | 'unavailable'
export type RiskDomain = 'general' | 'data' | 'ml' | 'analytics' | 'privacy' | 'governance' | 'security' | 'reliability'

export interface RiskAssessmentContext {
  scope: string
  domain: RiskDomain
  riskType: RiskType | undefined
  severity: RiskSeverity | undefined
  confidence: number | undefined
  evidence: RiskEvidenceState | undefined
  affectedAssets: number | undefined
  affectedModels: number | undefined
  action: string
  complete: boolean
}

const riskTypes = new Set<RiskType>(['data', 'collection', 'none'])
const severities = new Set<RiskSeverity>(['critical', 'high', 'medium', 'low', 'unknown'])
const evidenceStates = new Set<RiskEvidenceState>(['fresh', 'stale', 'unavailable'])
export const riskDomains: RiskDomain[] = ['general', 'data', 'ml', 'analytics', 'privacy', 'governance', 'security', 'reliability']
const domainSet = new Set(riskDomains)

function clauses(rule: string | undefined) {
  return new Map((rule ?? '').split(/\s*\|\s*/).flatMap((clause) => {
    const match = clause.match(/^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i)
    return match ? [[match[1].toLowerCase(), match[2]]] as const : []
  }))
}

export function riskDomainFromText(value: string | undefined): RiskDomain {
  const normalized = (value ?? '').toLowerCase().replace(/[_./:-]+/g, ' ')
  if (/\b(model|feature|training|serving|prediction|inference|deployment|drift|retrain|ml)\b/.test(normalized)) return 'ml'
  if (/\b(pii|privacy|personal|sensitive|gdpr|consent|mask|tokeni[sz])\b/.test(normalized)) return 'privacy'
  if (/\b(access|secret|credential|security|permission|encrypt)\b/.test(normalized)) return 'security'
  if (/\b(owner|ownership|tag|glossary|governance|policy|steward)\b/.test(normalized)) return 'governance'
  if (/\b(dashboard|metric|semantic|analytics|report|bi)\b/.test(normalized)) return 'analytics'
  if (/\b(connector|collection|timeout|network|mcp|graphql|availability|reliability)\b/.test(normalized)) return 'reliability'
  if (/\b(dataset|schema|column|quality|freshness|lineage|data)\b/.test(normalized)) return 'data'
  return 'general'
}

export function parseRiskAssessmentRule(rule: string | undefined): RiskAssessmentContext {
  const values = clauses(rule)
  const rawRiskType = values.get('risk_type')?.toLowerCase() as RiskType | undefined
  const rawSeverity = values.get('severity')?.toLowerCase() as RiskSeverity | undefined
  const rawEvidence = values.get('evidence')?.toLowerCase() as RiskEvidenceState | undefined
  const rawDomain = values.get('risk_domain')?.toLowerCase() as RiskDomain | undefined
  const rawConfidence = values.get('confidence')
  const rawAffectedAssets = values.get('affected_assets')
  const rawAffectedModels = values.get('affected_models')
  const confidence = rawConfidence === undefined ? undefined : Number(rawConfidence)
  const affectedAssets = rawAffectedAssets === undefined ? undefined : Number(rawAffectedAssets)
  const affectedModels = rawAffectedModels === undefined ? undefined : Number(rawAffectedModels)
  const scope = values.get('scope')?.trim() ?? ''
  const action = values.get('action')?.trim() ?? ''
  const result: RiskAssessmentContext = {
    scope,
    domain: rawDomain && domainSet.has(rawDomain) ? rawDomain : riskDomainFromText(`${scope} ${action}`),
    riskType: rawRiskType && riskTypes.has(rawRiskType) ? rawRiskType : undefined,
    severity: rawSeverity && severities.has(rawSeverity) ? rawSeverity : undefined,
    confidence: confidence !== undefined && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : undefined,
    evidence: rawEvidence && evidenceStates.has(rawEvidence) ? rawEvidence : undefined,
    affectedAssets: affectedAssets !== undefined && Number.isInteger(affectedAssets) && affectedAssets >= 0 ? affectedAssets : undefined,
    affectedModels: affectedModels !== undefined && Number.isInteger(affectedModels) && affectedModels >= 0 ? affectedModels : undefined,
    action,
    complete: false,
  }
  result.complete = Boolean(result.scope && result.riskType && result.severity && result.confidence !== undefined
    && result.evidence && result.affectedAssets !== undefined && result.action)
  return result
}

export const defaultRiskAssessmentRule = 'scope=downstream_assets | risk_domain=general | risk_type=none | severity=unknown | confidence=0 | evidence=unavailable | affected_assets=0 | action=read_versioned_lineage'
