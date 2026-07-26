import { describe, expect, it } from 'vitest'
import { catalogExplorerCheckpointScope, catalogExplorerPolicyError, catalogExplorerPolicyRule, defaultCatalogExplorerPolicy, parseCatalogExplorerPolicy } from './catalog-explorer-policy'

describe('adjustable Catalog Explorer policy', () => {
  it('keeps one checkpoint scope while prompts and worker tuning change', () => {
    expect(catalogExplorerCheckpointScope('scope=all_datasets | batch_size=4 | audit_concurrency=2')).toBe('all_datasets')
    expect(catalogExplorerCheckpointScope('scope=all_datasets | batch_size=16 | audit_concurrency=8')).toBe('all_datasets')
    expect(catalogExplorerCheckpointScope('scope=dataset | dataset_urn=urn:li:dataset:test | audit_concurrency=1')).toBe('dataset:urn:li:dataset:test')
  })

  it('keeps legacy catalog rules usable with bounded defaults', () => {
    const legacy = 'scope=all_datasets | page_size=10 | page_concurrency=6 | audit_concurrency=6 | checkpoint=versioned | resume=true'
    expect(catalogExplorerPolicyError(legacy)).toBeUndefined()
    expect(parseCatalogExplorerPolicy(legacy)).toMatchObject({
      scope: 'all_datasets',
      batchSize: 8,
      concurrency: 6,
      cacheMode: 'prefer',
    })
  })

  it('round-trips the focused single-dataset fast path', () => {
    const rule = catalogExplorerPolicyRule({
      ...defaultCatalogExplorerPolicy,
      scope: 'dataset',
      datasetUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)',
      batchSize: 1,
      concurrency: 1,
      cacheMode: 'refresh',
    })
    expect(catalogExplorerPolicyError(rule)).toBeUndefined()
    expect(parseCatalogExplorerPolicy(rule)).toMatchObject({
      scope: 'dataset',
      datasetUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)',
      batchSize: 1,
      concurrency: 1,
      cacheMode: 'refresh',
    })
  })

  it('rejects unbounded or incomplete policies', () => {
    expect(catalogExplorerPolicyError('scope=dataset | batch_size=1 | audit_concurrency=1 | cache=prefer | checkpoint=versioned | resume=true')).toContain('URN')
    expect(catalogExplorerPolicyError('scope=all_datasets | batch_size=99 | audit_concurrency=4 | cache=prefer | checkpoint=versioned | resume=true')).toContain('Batch')
  })
})
