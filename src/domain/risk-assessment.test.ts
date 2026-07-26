import { describe, expect, it } from 'vitest'
import { defaultRiskAssessmentRule, parseRiskAssessmentRule, riskDomainFromText } from './risk-assessment'

describe('risk assessment context', () => {
  it('parses a complete versioned ML risk contract', () => {
    expect(parseRiskAssessmentRule('scope=churn_model_v3 | risk_type=data | severity=high | confidence=0.86 | evidence=fresh | affected_assets=3 | action=repair_feature_then_retrain')).toEqual({
      scope: 'churn_model_v3',
      domain: 'ml',
      riskType: 'data',
      severity: 'high',
      confidence: 0.86,
      evidence: 'fresh',
      affectedAssets: 3,
      affectedModels: undefined,
      action: 'repair_feature_then_retrain',
      complete: true,
    })
  })

  it('accepts an explicit risk domain and affected model count', () => {
    expect(parseRiskAssessmentRule('scope=training_lineage | risk_domain=ml | risk_type=data | severity=critical | confidence=0.92 | evidence=fresh | affected_assets=5 | affected_models=2 | action=stop_deployment_then_retrain')).toMatchObject({
      domain: 'ml',
      affectedAssets: 5,
      affectedModels: 2,
      complete: true,
    })
  })

  it('infers a domain for older risk cards without changing their contract', () => {
    expect(riskDomainFromText('dashboard semantic metrics')).toBe('analytics')
    expect(parseRiskAssessmentRule('scope=customer_dashboard | risk_type=data | severity=medium | confidence=0.7 | evidence=fresh | affected_assets=1 | action=verify_metrics')).toMatchObject({
      domain: 'analytics',
      complete: true,
    })
  })

  it('keeps collection reliability distinct from a data anomaly', () => {
    const assessment = parseRiskAssessmentRule(defaultRiskAssessmentRule)
    expect(assessment).toMatchObject({ riskType: 'none', severity: 'unknown', evidence: 'unavailable', affectedAssets: 0, complete: true })
  })

  it('marks malformed or unbounded contracts incomplete', () => {
    expect(parseRiskAssessmentRule('scope=model | risk_type=data | severity=urgent | confidence=2')).toMatchObject({ complete: false, severity: undefined, confidence: undefined })
  })
})
