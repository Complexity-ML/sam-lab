import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'

type ScenarioPresetId = 'pii-masking' | 'schema-drift' | 'broken-governance' | 'license-reclamation' | 'compliance-exposure' | 'renewal-optimization'

interface ScenarioPreset {
  title: string
  nodes: PipelineNode[]
  edges: Edge[]
}

const fresh = { capturedAt: '2026-07-22T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', stale: false }

export const scenarioPresets: Record<ScenarioPresetId, ScenarioPreset> = {
  'pii-masking': {
    title: 'PII masking lab',
    nodes: [
      { id: 'pii-source', type: 'pipeline', position: { x: 100, y: 180 }, data: { kind: 'source', label: 'Synthetic customers', description: 'Public synthetic customer fixture with an intentionally exposed email field.', owner: 'Privacy Data', status: 'warning', schema: [{ name: 'customer_id', type: 'string' }, { name: 'email', type: 'string', tags: ['PII'] }], datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,data_lab_demo.synthetic_customers,PROD)', datahubTags: ['PII', 'SYNTHETIC'], datahubQuality: 'healthy', datahubFreshness: fresh } },
      { id: 'pii-output', type: 'pipeline', position: { x: 470, y: 180 }, data: { kind: 'output', label: 'Marketing audience', description: 'Intentionally unsafe direct output used to demonstrate the masking proposal.', owner: 'Growth Data', status: 'blocked', schema: [] } },
    ],
    edges: [{ id: 'e-pii-direct', source: 'pii-source', target: 'pii-output', type: 'elastic' }],
  },
  'schema-drift': {
    title: 'ML impact and schema drift',
    nodes: [
      { id: 'drift-source', type: 'pipeline', position: { x: 50, y: 180 }, data: { kind: 'source', label: 'Training customers v2', description: 'The synthetic training table changed customer_age from number to string.', owner: 'Customer Platform', status: 'warning', schema: [{ name: 'customer_id', type: 'string' }, { name: 'customer_age', type: 'string' }], datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,data_lab_demo.training_customers_v2,PROD)', datahubTags: ['SYNTHETIC', 'ML_TRAINING'], datahubQuality: 'healthy', datahubFreshness: fresh, datahubDownstream: [{ urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,data_lab_demo.customer_features,PROD)', name: 'customer_features', sensitive: false }, { urn: 'urn:li:mlModel:(data_lab_demo,churn_prediction_v3,PROD)', name: 'churn_prediction_v3', sensitive: false }] } },
      { id: 'impact-lineage', type: 'pipeline', position: { x: 345, y: 180 }, data: { kind: 'impact', label: 'Trace ML lineage impact', description: 'Atomic, replayable analysis of training_customers_v2 → customer_features → age_bucket → churn_prediction_v3.', owner: 'SAM LAB Agent', status: 'warning', schema: [{ name: 'customer_id', type: 'string' }, { name: 'customer_age', type: 'string' }], rule: 'scope(customer_age type change) → rank affected features, pipelines, models and deployments → recommend actions' } },
      { id: 'risk-churn-model', type: 'pipeline', position: { x: 665, y: 180 }, data: { kind: 'risk', label: 'Assess churn model risk', description: 'Classifies the verified customer_age drift as a high ML risk across the feature table, age bucket and production model.', owner: 'SAM LAB Agent', status: 'blocked', schema: [], rule: 'scope=churn_prediction_v3 | risk_type=data | severity=high | confidence=0.93 | evidence=fresh | affected_assets=3 | action=repair_age_bucket_then_retrain' } },
      { id: 'drift-contract', type: 'pipeline', position: { x: 985, y: 180 }, data: { kind: 'validation', label: 'Feature schema contract', description: 'The feature pipeline still requires numeric customer_age.', owner: 'ML Platform', status: 'blocked', schema: [], rule: 'schema_contract: customer_id:string, customer_age:number' } },
      { id: 'drift-output', type: 'pipeline', position: { x: 1305, y: 180 }, data: { kind: 'output', label: 'churn_prediction_v3', description: 'Production model deployment at high risk until age_bucket is repaired and the model is retrained.', owner: 'ML Platform', status: 'blocked', schema: [] } },
    ],
    edges: [
      { id: 'e-drift-impact', source: 'drift-source', target: 'impact-lineage', type: 'elastic' },
      { id: 'e-impact-risk', source: 'impact-lineage', target: 'risk-churn-model', type: 'elastic' },
      { id: 'e-drift-contract', source: 'risk-churn-model', target: 'drift-contract', type: 'elastic' },
      { id: 'e-drift-output', source: 'drift-contract', target: 'drift-output', type: 'elastic' },
    ],
  },
  'broken-governance': {
    title: 'Ownership and quality lab',
    nodes: [
      { id: 'governance-source', type: 'pipeline', position: { x: 100, y: 180 }, data: { kind: 'source', label: 'Synthetic orders', description: 'Catalog fixture with no owner and a failing quality assertion.', owner: 'Unassigned', status: 'blocked', schema: [{ name: 'order_id', type: 'string' }, { name: 'amount', type: 'number' }], datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,data_lab_demo.synthetic_orders,PROD)', datahubTags: ['SYNTHETIC'], datahubQuality: 'failing', datahubFreshness: fresh } },
      { id: 'governance-output', type: 'pipeline', position: { x: 470, y: 180 }, data: { kind: 'output', label: 'Finance metrics', description: 'Publishing remains blocked until ownership and quality are repaired.', owner: 'Finance Analytics', status: 'blocked', schema: [] } },
    ],
    edges: [{ id: 'e-governance-output', source: 'governance-source', target: 'governance-output', type: 'elastic' }],
  },
  'license-reclamation': {
    title: 'License reclamation',
    nodes: [
      { id: 'sam-license-source', type: 'pipeline', position: { x: 80, y: 210 }, data: { kind: 'source', label: 'SaaS inventory', description: 'Bounded inventory of purchased, assigned and active software seats.', owner: 'SAM Team', status: 'healthy', schema: [{ name: 'product', type: 'string' }, { name: 'purchased_seats', type: 'number' }, { name: 'assigned_seats', type: 'number' }, { name: 'active_seats', type: 'number' }, { name: 'annual_unit_cost', type: 'number' }] } },
      { id: 'sam-normalize-assets', type: 'pipeline', position: { x: 390, y: 210 }, data: { kind: 'transform', label: 'Normalize vendors and SKUs', description: 'Maps product aliases to canonical vendor, product, edition and license identifiers.', owner: 'SAM LAB Agent', status: 'healthy', schema: [], rule: 'canonicalize(vendor, product, edition, sku)' } },
      { id: 'sam-usage-analysis', type: 'pipeline', position: { x: 700, y: 210 }, data: { kind: 'analysis', label: 'Find unused licenses', description: 'Compares purchased, assigned and active seats without exposing individual usage rows.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'unused_seats=max(0,purchased_seats-active_seats)' } },
      { id: 'sam-cost-impact', type: 'pipeline', position: { x: 1010, y: 210 }, data: { kind: 'impact', label: 'Calculate annual waste', description: 'Quantifies annualized recoverable spend and affected products.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'annualized_waste=unused_seats*annual_unit_cost' } },
      { id: 'sam-reclaim-risk', type: 'pipeline', position: { x: 1320, y: 210 }, data: { kind: 'risk', label: 'License reclamation risk', description: 'Classifies the evidence and prevents automatic removal of business-critical access.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'scope=inactive_software_seats | risk_domain=governance | risk_type=data | severity=medium | confidence=0.9 | evidence=fresh | affected_assets=3 | action=owner_review_then_reclaim' } },
      { id: 'sam-reclaim-review', type: 'pipeline', position: { x: 1630, y: 210 }, data: { kind: 'review', label: 'Approve reclamation plan', description: 'Software owners review the proposed seats before any external action.', owner: 'Software Owners', status: 'draft', schema: [], rule: 'approve=reclaim_plan | reject=retain_assignments' } },
      { id: 'sam-reclaim-output', type: 'pipeline', position: { x: 1940, y: 210 }, data: { kind: 'output', label: 'SAM optimization report', description: 'Reviewed list of reclaim, downgrade and investigate recommendations.', owner: 'SAM Team', status: 'draft', schema: [] } },
    ],
    edges: [
      { id: 'sam-e-license-normalize', source: 'sam-license-source', target: 'sam-normalize-assets', type: 'elastic' },
      { id: 'sam-e-normalize-usage', source: 'sam-normalize-assets', target: 'sam-usage-analysis', type: 'elastic' },
      { id: 'sam-e-usage-impact', source: 'sam-usage-analysis', target: 'sam-cost-impact', type: 'elastic' },
      { id: 'sam-e-impact-risk', source: 'sam-cost-impact', target: 'sam-reclaim-risk', type: 'elastic' },
      { id: 'sam-e-risk-review', source: 'sam-reclaim-risk', target: 'sam-reclaim-review', type: 'elastic' },
      { id: 'sam-e-review-output', source: 'sam-reclaim-review', target: 'sam-reclaim-output', type: 'elastic' },
    ],
  },
  'compliance-exposure': {
    title: 'Entitlement compliance',
    nodes: [
      { id: 'sam-contract-source', type: 'pipeline', position: { x: 90, y: 220 }, data: { kind: 'source', label: 'Contracts and entitlements', description: 'Normalized purchase, assignment and entitlement evidence by software product.', owner: 'Procurement', status: 'healthy', schema: [{ name: 'product', type: 'string' }, { name: 'purchased_seats', type: 'number' }, { name: 'assigned_seats', type: 'number' }, { name: 'contract_end', type: 'timestamp' }] } },
      { id: 'sam-entitlement-analysis', type: 'pipeline', position: { x: 420, y: 220 }, data: { kind: 'analysis', label: 'Compare use to entitlement', description: 'Detects over-assignment, missing contracts and unapproved software records.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'compare(assignments, entitlements, approvals)' } },
      { id: 'sam-compliance-risk', type: 'pipeline', position: { x: 750, y: 220 }, data: { kind: 'risk', label: 'Compliance exposure', description: 'Ranks license and policy exposure using fresh contract evidence.', owner: 'SAM LAB Agent', status: 'blocked', schema: [], rule: 'scope=software_entitlements | risk_domain=governance | risk_type=data | severity=high | confidence=0.95 | evidence=fresh | affected_assets=2 | action=verify_contract_then_remediate' } },
      { id: 'sam-compliance-review', type: 'pipeline', position: { x: 1080, y: 220 }, data: { kind: 'review', label: 'Legal and procurement review', description: 'Approves remediation only after the source contract and ownership are confirmed.', owner: 'Legal & Procurement', status: 'draft', schema: [], rule: 'require=contract_and_owner_confirmation' } },
      { id: 'sam-compliance-output', type: 'pipeline', position: { x: 1410, y: 220 }, data: { kind: 'output', label: 'Compliance action register', description: 'Reviewed exceptions, evidence gaps and remediation owners.', owner: 'SAM Team', status: 'draft', schema: [] } },
    ],
    edges: [
      { id: 'sam-e-contract-analysis', source: 'sam-contract-source', target: 'sam-entitlement-analysis', type: 'elastic' },
      { id: 'sam-e-analysis-compliance', source: 'sam-entitlement-analysis', target: 'sam-compliance-risk', type: 'elastic' },
      { id: 'sam-e-compliance-review', source: 'sam-compliance-risk', target: 'sam-compliance-review', type: 'elastic' },
      { id: 'sam-e-compliance-output', source: 'sam-compliance-review', target: 'sam-compliance-output', type: 'elastic' },
    ],
  },
  'renewal-optimization': {
    title: 'Renewal optimization',
    nodes: [
      { id: 'sam-renewal-source', type: 'pipeline', position: { x: 100, y: 220 }, data: { kind: 'source', label: 'Renewal calendar', description: 'Upcoming software renewals with contract value, owner and utilization evidence.', owner: 'Procurement', status: 'healthy', schema: [{ name: 'product', type: 'string' }, { name: 'renewal_date', type: 'timestamp' }, { name: 'annual_cost', type: 'number' }, { name: 'utilization_rate', type: 'number' }] } },
      { id: 'sam-renewal-impact', type: 'pipeline', position: { x: 430, y: 220 }, data: { kind: 'impact', label: 'Rank renewal exposure', description: 'Ranks near-term renewals by spend, utilization, dependency and evidence coverage.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'rank(days_to_renewal, annual_cost, utilization_rate, owner_criticality)' } },
      { id: 'sam-renewal-risk', type: 'pipeline', position: { x: 760, y: 220 }, data: { kind: 'risk', label: 'Renewal decision risk', description: 'Prevents autonomous cancellation when usage or ownership evidence is incomplete.', owner: 'SAM LAB Agent', status: 'warning', schema: [], rule: 'scope=renewals_next_90_days | risk_domain=governance | risk_type=data | severity=medium | confidence=0.88 | evidence=fresh | affected_assets=4 | action=collect_owner_intent_then_negotiate' } },
      { id: 'sam-renewal-review', type: 'pipeline', position: { x: 1090, y: 220 }, data: { kind: 'review', label: 'Approve renewal strategy', description: 'Owners approve renew, resize, negotiate or retire recommendations.', owner: 'Budget Owners', status: 'draft', schema: [], rule: 'approve=renewal_strategy | reject=retain_current_terms' } },
      { id: 'sam-renewal-output', type: 'pipeline', position: { x: 1420, y: 220 }, data: { kind: 'output', label: 'Renewal plan', description: 'Reviewed renewal decisions with savings targets and evidence gaps.', owner: 'Procurement', status: 'draft', schema: [] } },
    ],
    edges: [
      { id: 'sam-e-renewal-impact', source: 'sam-renewal-source', target: 'sam-renewal-impact', type: 'elastic' },
      { id: 'sam-e-renewal-risk', source: 'sam-renewal-impact', target: 'sam-renewal-risk', type: 'elastic' },
      { id: 'sam-e-renewal-review', source: 'sam-renewal-risk', target: 'sam-renewal-review', type: 'elastic' },
      { id: 'sam-e-renewal-output', source: 'sam-renewal-review', target: 'sam-renewal-output', type: 'elastic' },
    ],
  },
}
