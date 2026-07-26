import { describe, expect, it } from 'vitest'
import { createDataProfileSnapshot } from '../domain/data-profile'
import type { DataHubAssetSummary } from '../domain/datahub'
import { customerActivationEdges as initialEdges, customerActivationNodes as initialNodes, newCard } from '../domain/pipeline'
import { validatePipeline, validationAtoms } from '.'

const sensitiveAsset: DataHubAssetSummary = {
  urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)',
  name: 'customers',
  platform: 'snowflake',
  environment: 'PROD',
  description: 'Customers',
  owners: ['Data Governance'],
  domain: 'Growth',
  tags: ['PII'],
  qualityStatus: 'healthy',
  upstream: [],
  downstream: [],
  fields: [{ name: 'email', type: 'string', tags: ['PII'] }],
  freshness: { capturedAt: '2026-07-24T10:00:00.000Z', expiresAt: '2099-07-24T11:00:00.000Z', stale: false },
}

const aggregateAsset: DataHubAssetSummary = {
  ...sensitiveAsset,
  urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.metrics,PROD)',
  name: 'metrics',
  description: 'Model input metrics',
  tags: [],
  fields: [{ name: 'score', type: 'number' }],
  dataProfile: {
    status: 'available',
    capturedAt: '2026-07-24T10:00:00.000Z',
    previousCapturedAt: '2026-07-23T10:00:00.000Z',
    rowCount: 700,
    previousRowCount: 1_000,
    fields: [{ name: 'score', nullRate: 0.2, previousNullRate: 0.05, distinctCount: 640 }],
    risks: [{
      id: 'null-spike-score',
      kind: 'null_spike',
      severity: 'high',
      field: 'score',
      summary: 'score null rate increased from 5% to 20%.',
      current: 0.2,
      previous: 0.05,
    }],
  },
}

describe('atomic pipeline validation', () => {
  it('exposes small independently addressable validators', () => {
    expect(validationAtoms.map((atom) => atom.id)).toEqual([
      'pipeline-presence',
      'pipeline-terminals',
      'edge-integrity',
      'acyclic-lineage',
      'card-contracts',
      'schema-contract',
      'sensitive-data-path',
      'datahub-governance',
    ])
  })

  it('blocks stale sensitive evidence and missing DataHub ownership without calling it healthy', () => {
    const source = {
      ...newCard('source', 0),
      id: 'governed-source',
      data: {
        ...newCard('source', 0).data,
        datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)',
        datahubTags: ['PII'],
        datahubQuality: 'unavailable' as const,
        datahubFreshness: { capturedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:00.000Z', stale: true },
      },
    }
    const findings = validatePipeline([source], [])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'missing-owner-governed-source', severity: 'error' }),
      expect.objectContaining({ id: 'metadata-stale-governed-source', severity: 'error' }),
      expect.objectContaining({ id: 'quality-unavailable-governed-source', severity: 'warning' }),
    ]))
  })

  it('rejects an empty pipeline instead of reporting a false success', () => {
    expect(validatePipeline([], [])).toEqual([
      expect.objectContaining({
        id: 'empty-pipeline',
        atomId: 'pipeline-presence',
        severity: 'error',
      }),
    ])
  })

  it('attributes every finding to the atom that produced it', () => {
    const findings = validatePipeline(initialNodes, initialEdges)
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sensitive-unprotected-customers-source-activation-output', atomId: 'sensitive-data-path' })]))
  })

  it('requires source and terminal output cards with stable atom IDs', () => {
    const analysis = { ...newCard('analysis', 0), id: 'analysis' }
    expect(validatePipeline([analysis], [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'missing-source', atomId: 'pipeline-terminals', severity: 'error' }),
      expect.objectContaining({ id: 'missing-output', atomId: 'pipeline-terminals', severity: 'error' }),
    ]))
  })

  it('does not treat host-owned discovery sidecars as an incomplete runnable pipeline', () => {
    const control = { ...newCard('control', 0), id: 'control' }
    const explorer = { ...newCard('explorer', 1), id: 'explorer' }
    const findings = validatePipeline([control, explorer], [])

    expect(findings.some((finding) => finding.atomId === 'pipeline-terminals')).toBe(false)
    expect(findings.some((finding) => finding.severity === 'error')).toBe(false)
  })

  it('validates exact split handle contracts', () => {
    const split = { ...newCard('split', 0), id: 'split' }
    const approved = { ...newCard('output', 1), id: 'approved-output' }
    const quarantine = { ...newCard('output', 2), id: 'quarantine-output' }
    const findings = validatePipeline([split, approved, quarantine], [
      { id: 'e-approved-1', source: 'split', target: 'approved-output', sourceHandle: 'approved' },
      { id: 'e-approved-2', source: 'split', target: 'quarantine-output', sourceHandle: 'approved' },
    ])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'split-handle-approved-split', severity: 'error' }),
      expect.objectContaining({ id: 'split-handle-quarantine-split', severity: 'error' }),
    ]))
  })

  it('evaluates sensitive protection independently on each output path', () => {
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, schema: [{ name: 'email', type: 'string' as const, tags: ['PII'] }] } }
    const mask = { ...newCard('transform', 1), id: 'mask', data: { ...newCard('transform', 1).data, rule: 'sha256(email)' } }
    const safe = { ...newCard('output', 2), id: 'safe' }
    const unsafe = { ...newCard('output', 3), id: 'unsafe' }
    const findings = validatePipeline([source, mask, safe, unsafe], [
      { id: 'safe-1', source: 'source', target: 'mask' },
      { id: 'safe-2', source: 'mask', target: 'safe' },
      { id: 'unsafe-1', source: 'source', target: 'unsafe' },
    ])
    expect(findings.some((finding) => finding.id.endsWith('-safe'))).toBe(false)
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sensitive-unprotected-source-unsafe', severity: 'error' })]))
  })

  it('allows a sensitive source to publish only host-verified bounded metadata', () => {
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, schema: sensitiveAsset.fields, datahubUrn: sensitiveAsset.urn } }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: createDataProfileSnapshot(sensitiveAsset) } }
    const output = { ...newCard('output', 2), id: 'output' }
    const findings = validatePipeline([source, profile, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-output', source: profile.id, target: output.id },
    ])
    expect(findings.some((finding) => finding.id === 'sensitive-unprotected-source-output')).toBe(false)
  })

  it('does not trust a metadata-only label or an unverified profile proof', () => {
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, schema: sensitiveAsset.fields, datahubUrn: sensitiveAsset.urn } }
    const snapshot = createDataProfileSnapshot(sensitiveAsset)
    const profile = {
      ...newCard('profile', 1),
      id: 'profile',
      data: {
        ...newCard('profile', 1).data,
        description: 'Metadata-only profile with no raw rows.',
        profile: { ...snapshot, storage: { ...snapshot.storage, hostVerified: false } },
      },
    }
    const output = { ...newCard('output', 2), id: 'output' }
    const findings = validatePipeline([source, profile, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-output', source: profile.id, target: output.id },
    ])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensitive-unprotected-source-output', severity: 'error' }),
    ]))
  })

  it('does not reuse a valid metadata proof from another dataset', () => {
    const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, schema: sensitiveAsset.fields, datahubUrn: sensitiveAsset.urn } }
    const otherProfile = createDataProfileSnapshot({ ...sensitiveAsset, urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.other,PROD)' })
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: otherProfile } }
    const output = { ...newCard('output', 2), id: 'output' }
    const findings = validatePipeline([source, profile, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-output', source: profile.id, target: output.id },
    ])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensitive-unprotected-source-output', severity: 'error' }),
    ]))
  })

  it('validates the Human Review card contract independently', () => {
    const review = { ...newCard('review', 1), id: 'review' }
    expect(validatePipeline([...initialNodes, review], initialEdges)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review-path-review', atomId: 'card-contracts' }),
    ]))
  })

  it('accepts a replayable graph-only patch only after a context-reading card', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const analysis = { ...newCard('analysis', 1), id: 'analysis' }
    const patch = { ...newCard('patch', 2), id: 'patch' }
    const output = { ...newCard('output', 3), id: 'output' }
    const findings = validatePipeline([source, analysis, patch, output], [
      { id: 'source-analysis', source: source.id, target: analysis.id },
      { id: 'analysis-patch', source: analysis.id, target: patch.id },
      { id: 'patch-output', source: patch.id, target: output.id },
    ])
    expect(findings.some((finding) => finding.id.startsWith('patch-'))).toBe(false)
  })

  it('accepts Query Check reads and graph-only patch revalidation paths', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const metadataRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=entity.read | mode=read_only | variables=host_validated | timeout_ms=8000 | review=not_required | dry_run=not_applicable | rollback=not_applicable | response=bounded_metadata'
    const query = { ...newCard('query', 1), id: 'query', data: { ...newCard('query', 1).data, rule: metadataRule } }
    const analysis = { ...newCard('analysis', 2), id: 'analysis' }
    const patch = { ...newCard('patch', 3), id: 'patch' }
    const recheck = { ...newCard('query', 4), id: 'recheck', data: { ...newCard('query', 4).data, rule: metadataRule } }
    const output = { ...newCard('output', 5), id: 'output' }
    const findings = validatePipeline([source, query, analysis, patch, recheck, output], [
      { id: 'source-query', source: source.id, target: query.id },
      { id: 'query-analysis', source: query.id, target: analysis.id },
      { id: 'analysis-patch', source: analysis.id, target: patch.id },
      { id: 'patch-recheck', source: patch.id, target: recheck.id },
      { id: 'recheck-output', source: recheck.id, target: output.id },
    ])
    expect(findings.some((finding) => finding.id.startsWith('query-') || finding.id.startsWith('patch-') || finding.id.startsWith('compatibility-'))).toBe(false)
  })

  it('routes a bounded aggregate Query Check into versioned Data Profile evidence', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const query = { ...newCard('query', 1), id: 'query' }
    const profile = {
      ...newCard('profile', 2),
      id: 'profile',
      data: { ...newCard('profile', 2).data, profile: createDataProfileSnapshot(aggregateAsset) },
    }
    const output = { ...newCard('output', 3), id: 'output' }
    const findings = validatePipeline([source, query, profile, output], [
      { id: 'source-query', source: source.id, target: query.id },
      { id: 'query-profile', source: query.id, target: profile.id },
      { id: 'profile-output', source: profile.id, target: output.id },
    ])

    expect(findings.some((finding) => finding.id.startsWith('query-'))).toBe(false)
  })

  it('requires a downstream Human Review for governed Query Check writes', () => {
    const writeRule = 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=metadata.update | mode=governed_write | variables=host_validated | timeout_ms=8000 | review=required | dry_run=required | rollback=versioned | response=mutation_receipt'
    const source = { ...newCard('source', 0), id: 'source' }
    const query = { ...newCard('query', 1), id: 'query', data: { ...newCard('query', 1).data, rule: writeRule } }
    const output = { ...newCard('output', 2), id: 'output' }
    const withoutReview = validatePipeline([source, query, output], [
      { id: 'source-query', source: source.id, target: query.id },
      { id: 'query-output', source: query.id, target: output.id },
    ])
    expect(withoutReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'query-write-review-query', severity: 'error' }),
    ]))

    const review = { ...newCard('review', 3), id: 'review' }
    const withReview = validatePipeline([source, query, review, output], [
      { id: 'source-query', source: source.id, target: query.id },
      { id: 'query-review', source: query.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ])
    expect(withReview.some((finding) => finding.id === 'query-write-review-query')).toBe(false)
  })

  it('accepts an atomic ML risk assessment backed by fresh impact evidence', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: createDataProfileSnapshot(aggregateAsset) } }
    const impact = { ...newCard('impact', 2), id: 'impact' }
    const risk = { ...newCard('risk', 3), id: 'risk', data: { ...newCard('risk', 3).data, rule: 'scope=churn_model_v3 | risk_domain=ml | risk_type=data | severity=high | confidence=0.91 | evidence=fresh | affected_assets=3 | affected_models=1 | action=repair_feature_then_retrain' } }
    const patch = { ...newCard('patch', 4), id: 'patch' }
    const output = { ...newCard('output', 5), id: 'output' }
    const findings = validatePipeline([source, profile, impact, risk, patch, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-impact', source: profile.id, target: impact.id },
      { id: 'impact-risk', source: impact.id, target: risk.id },
      { id: 'risk-patch', source: risk.id, target: patch.id },
      { id: 'patch-output', source: patch.id, target: output.id },
    ])
    expect(findings.some((finding) => finding.id.startsWith('risk-'))).toBe(false)
  })

  it('asks the agent to cover every Impact Analysis with an evidence-backed Risk Assessment', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const impact = { ...newCard('impact', 1), id: 'impact' }
    const output = { ...newCard('output', 2), id: 'output' }
    const findings = validatePipeline([source, impact, output], [
      { id: 'source-impact', source: source.id, target: impact.id },
      { id: 'impact-output', source: impact.id, target: output.id },
    ])

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'impact-risk-coverage-impact', severity: 'warning' }),
    ]))
  })

  it('warns when elevated risk has no bounded mitigation path', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: createDataProfileSnapshot(aggregateAsset) } }
    const impact = { ...newCard('impact', 2), id: 'impact' }
    const risk = {
      ...newCard('risk', 3),
      id: 'risk',
      data: {
        ...newCard('risk', 3).data,
        rule: 'scope=customer_dataset | risk_domain=data | risk_type=data | severity=critical | confidence=0.95 | evidence=fresh | affected_assets=1 | action=quarantine_then_recheck',
      },
    }
    const output = { ...newCard('output', 4), id: 'output' }
    const findings = validatePipeline([source, profile, impact, risk, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-impact', source: profile.id, target: impact.id },
      { id: 'impact-risk', source: impact.id, target: risk.id },
      { id: 'risk-output', source: risk.id, target: output.id },
    ])

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'risk-mitigation-risk', severity: 'warning' }),
    ]))
  })

  it('blocks a value-level data risk that relies on schema-only profile evidence', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const profile = { ...newCard('profile', 1), id: 'profile', data: { ...newCard('profile', 1).data, profile: createDataProfileSnapshot(sensitiveAsset) } }
    const impact = { ...newCard('impact', 2), id: 'impact' }
    const risk = { ...newCard('risk', 3), id: 'risk', data: { ...newCard('risk', 3).data, rule: 'scope=customer_dataset | risk_domain=data | risk_type=data | severity=high | confidence=0.9 | evidence=fresh | affected_assets=1 | action=quarantine_then_recheck' } }
    const output = { ...newCard('output', 4), id: 'output' }
    const findings = validatePipeline([source, profile, impact, risk, output], [
      { id: 'source-profile', source: source.id, target: profile.id },
      { id: 'profile-impact', source: profile.id, target: impact.id },
      { id: 'impact-risk', source: impact.id, target: risk.id },
      { id: 'risk-output', source: risk.id, target: output.id },
    ])

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'risk-aggregate-evidence-risk', severity: 'error' }),
    ]))
  })

  it('blocks a dataset risk inferred only from unavailable connector evidence', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const impact = { ...newCard('impact', 1), id: 'impact' }
    const risk = { ...newCard('risk', 2), id: 'risk', data: { ...newCard('risk', 2).data, rule: 'scope=churn_model_v3 | risk_type=data | severity=critical | confidence=0.9 | evidence=unavailable | affected_assets=2 | action=stop_model' } }
    const output = { ...newCard('output', 3), id: 'output' }
    const findings = validatePipeline([source, impact, risk, output], [
      { id: 'source-impact', source: source.id, target: impact.id },
      { id: 'impact-risk', source: impact.id, target: risk.id },
      { id: 'risk-output', source: risk.id, target: output.id },
    ])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'risk-data-evidence-risk', severity: 'error' }),
    ]))
  })

  it('keeps collection reliability from claiming affected data assets', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const analysis = { ...newCard('analysis', 1), id: 'analysis' }
    const risk = { ...newCard('risk', 2), id: 'risk', data: { ...newCard('risk', 2).data, rule: 'scope=datahub_mcp | risk_type=collection | severity=high | confidence=1 | evidence=unavailable | affected_assets=4 | action=retry_connector' } }
    const output = { ...newCard('output', 3), id: 'output' }
    const findings = validatePipeline([source, analysis, risk, output], [
      { id: 'source-analysis', source: source.id, target: analysis.id },
      { id: 'analysis-risk', source: analysis.id, target: risk.id },
      { id: 'risk-output', source: risk.id, target: output.id },
    ])
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'risk-collection-impact-risk', severity: 'error' }),
    ]))
  })

  it('keeps feedback loops bounded and rejects feedback outside Output-to-Monitor', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const monitor = { ...newCard('monitor', 1), id: 'monitor' }
    const output = { ...newCard('output', 2), id: 'output' }
    const valid = validatePipeline([source, monitor, output], [
      { id: 'source-monitor', source: source.id, target: monitor.id },
      { id: 'monitor-output', source: monitor.id, target: output.id },
      { id: 'feedback', source: output.id, target: monitor.id, sourceHandle: 'feedback' },
    ])
    expect(valid.some((finding) => finding.id === 'cycle')).toBe(false)
    expect(valid.some((finding) => finding.id === 'output-edge-output')).toBe(false)

    const invalid = validatePipeline([source, monitor, output], [
      { id: 'invalid-feedback', source: source.id, target: monitor.id, sourceHandle: 'feedback' },
      { id: 'monitor-output', source: monitor.id, target: output.id },
    ])
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'compatibility-invalid-feedback', severity: 'error' })]))
  })

  it('requires Parallel Agents to fan out with branch-only context and atomic merge', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const parallel = { ...newCard('parallel', 1), id: 'parallel' }
    const left = { ...newCard('output', 2), id: 'left' }
    const right = { ...newCard('output', 3), id: 'right' }
    const findings = validatePipeline([source, parallel, left, right], [
      { id: 'source-parallel', source: source.id, target: parallel.id },
      { id: 'parallel-left', source: parallel.id, target: left.id },
      { id: 'parallel-right', source: parallel.id, target: right.id },
    ])
    expect(findings.some((finding) => finding.id.startsWith('parallel-'))).toBe(false)
  })

  it('allows every lineage card to fan into and out of one bounded Worker Node', () => {
    const sourceA = { ...newCard('source', 0), id: 'source-a' }
    const sourceB = { ...newCard('source', 1), id: 'source-b' }
    const worker = { ...newCard('worker', 2), id: 'worker' }
    const outputA = { ...newCard('output', 3), id: 'output-a' }
    const outputB = { ...newCard('output', 4), id: 'output-b' }
    const findings = validatePipeline([sourceA, sourceB, worker, outputA, outputB], [
      { id: 'source-a-worker', source: sourceA.id, target: worker.id },
      { id: 'source-b-worker', source: sourceB.id, target: worker.id },
      { id: 'worker-output-a', source: worker.id, target: outputA.id },
      { id: 'worker-output-b', source: worker.id, target: outputB.id },
    ])

    expect(findings.some((finding) => finding.nodeId === worker.id)).toBe(false)
  })

  it('keeps the autonomous exploration Worker Node as a host sidecar before lineage exists', () => {
    const control = { ...newCard('control', 0), id: 'control' }
    const worker = {
      ...newCard('worker', 1),
      id: 'catalog-worker',
      data: {
        ...newCard('worker', 1).data,
        rule: 'role=exploration | batch_size=8 | max_concurrency=4 | retry=checkpoint | context=branch_only | merge=atomic',
      },
    }
    const explorer = { ...newCard('explorer', 2), id: 'explorer' }
    const findings = validatePipeline([control, worker, explorer], [])

    expect(findings.some((finding) => finding.severity === 'error')).toBe(false)
  })

  it('rejects an unbounded Worker Node policy', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const worker = { ...newCard('worker', 1), id: 'worker', data: { ...newCard('worker', 1).data, rule: 'role=audit | batch_size=1000 | max_concurrency=99 | retry=forever' } }
    const output = { ...newCard('output', 2), id: 'output' }
    const findings = validatePipeline([source, worker, output], [
      { id: 'source-worker', source: source.id, target: worker.id },
      { id: 'worker-output', source: worker.id, target: output.id },
    ])

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'worker-policy-worker', severity: 'error' }),
    ]))
  })

  it('treats a Data Profile as sidecar memory rather than an executable orphan', () => {
    const profile = { ...newCard('profile', 9), id: 'profile-memory' }
    const findings = validatePipeline([...initialNodes, profile], initialEdges)
    expect(findings.some((finding) => finding.nodeId === profile.id && finding.atomId === 'card-contracts')).toBe(false)
  })

  it('keeps one SAM LAB Control card outside lineage with a complete player policy', () => {
    const source = { ...newCard('source', 0), id: 'control-test-source' }
    const output = { ...newCard('output', 1), id: 'control-test-output' }
    const control = { ...newCard('control', 9), id: 'control-policy' }
    const baseNodes = [source, output]
    const baseEdges = [{ id: 'control-test-path', source: source.id, target: output.id }]
    const valid = validatePipeline([...baseNodes, control], baseEdges)
    expect(valid.some((finding) => finding.nodeId === control.id && finding.atomId === 'card-contracts')).toBe(false)

    const connected = validatePipeline([...baseNodes, control], [...baseEdges, { id: 'control-source', source: control.id, target: source.id }])
    expect(connected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'control-edge-control-policy', severity: 'error' }),
    ]))
  })

  it('keeps one complete Catalog Explorer outside dataset lineage', () => {
    const explorer = { ...newCard('explorer', 9), id: 'catalog-explorer' }
    const valid = validatePipeline([...initialNodes, explorer], initialEdges)
    expect(valid.some((finding) => finding.nodeId === explorer.id && finding.atomId === 'card-contracts')).toBe(false)

    const connected = validatePipeline([...initialNodes, explorer], [...initialEdges, { id: 'explorer-edge', source: explorer.id, target: initialNodes[0]!.id }])
    expect(connected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'explorer-edge-catalog-explorer', severity: 'error' }),
    ]))
  })

  it('detects a declared breaking schema type drift', () => {
    const source = { ...newCard('source', 0), id: 'drift-source', data: { ...newCard('source', 0).data, schema: [{ name: 'customer_id', type: 'number' as const }] } }
    const contract = { ...newCard('validation', 1), id: 'drift-contract', data: { ...newCard('validation', 1).data, rule: 'schema_contract: customer_id:string' } }
    const output = { ...newCard('output', 2), id: 'drift-output' }
    const findings = validatePipeline([source, contract, output], [{ id: 'e-1', source: source.id, target: contract.id }, { id: 'e-2', source: contract.id, target: output.id }])
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'schema-contract-type-drift-contract-customer_id', atomId: 'schema-contract', severity: 'error' })]))
  })
})
