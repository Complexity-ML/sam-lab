import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronState = vi.hoisted(() => ({ directory: '', encryptionAvailable: true, availabilityChecks: 0, decryptions: 0 }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.directory },
  safeStorage: {
    decryptString: (buffer: Buffer) => { electronState.decryptions += 1; return buffer.toString('utf8').replace(/^encrypted:/, '') },
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    isEncryptionAvailable: () => { electronState.availabilityChecks += 1; return electronState.encryptionAvailable },
  },
}))

import { assertBoundedMcpPayload, buildDataHubSearchQuery, callToolWithSdkTimeout, getDataHubMcpConfigurationStatus, hasExplicitDataHubWritebackTool, inspectDataHubAsset, mapWithRetryConcurrency, normalizeDataHubMcpStartupError, parseDataHubDecisionRequest, resolveCatalogEntityTimeoutMs, resolveCatalogSearchTotal, resolveDataHubMcpCommand, resolveEvidenceTtlMs, resolveLineageArguments, resolveReadableToolNames, saveDataHubMcpSettings, searchDataHubAssets, writeDataHubDecision } from './datahub-mcp.js'
import { closeWorkspaceDatabase } from './workspace-db.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sam-lab-datahub-'))
  electronState.directory = directory
  electronState.encryptionAvailable = true
  electronState.availabilityChecks = 0
  electronState.decryptions = 0
  process.env.DATAHUB_MCP_URL = ''
  process.env.DATAHUB_MCP_TOKEN = ''
  process.env.DATAHUB_GMS_URL = ''
  process.env.DATAHUB_GMS_TOKEN = ''
  process.env.DATAHUB_CATALOG_READ_ROUTE = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  closeWorkspaceDatabase()
  rmSync(directory, { force: true, recursive: true })
})

describe('DataHub MCP connection settings', () => {
  it('reports startup status without probing or opening operating-system secure storage', () => {
    const status = getDataHubMcpConfigurationStatus()
    expect(status.settings.tokenSource).toBe('none')
    expect(electronState.availabilityChecks).toBe(0)
    expect(electronState.decryptions).toBe(0)
  })

  it('finds uvx in the macOS user install directory even when the app PATH is minimal', () => {
    const expected = '/Users/sam-lab/.local/bin/uvx'
    expect(resolveDataHubMcpCommand({ PATH: '/usr/bin:/bin' }, 'darwin', '/Users/sam-lab', (candidate) => candidate === expected)).toBe(expected)
    expect(resolveDataHubMcpCommand({ DATAHUB_MCP_COMMAND: '/custom/bin/datahub-mcp' }, 'darwin', '/Users/sam-lab', () => false)).toBe('/custom/bin/datahub-mcp')
  })

  it('uses Windows path rules when resolving uvx for a Windows desktop build', () => {
    const expected = 'C:\\Users\\sam-lab\\.local\\bin\\uvx.exe'
    expect(resolveDataHubMcpCommand({ PATH: 'C:\\Windows;C:\\Tools' }, 'win32', 'C:\\Users\\sam-lab', (candidate) => candidate === expected)).toBe(expected)
  })

  it('turns a missing uvx spawn failure into an actionable desktop message', () => {
    const error = Object.assign(new Error('spawn uvx ENOENT'), { code: 'ENOENT' })
    expect(normalizeDataHubMcpStartupError(error, 'uvx').message).toContain('Install uv, restart SAM LAB')
  })

  it('rejects oversized or non-serializable MCP responses before parsing or caching them', () => {
    expect(() => assertBoundedMcpPayload({ content: 'x'.repeat(1_001) }, 'test response', 1_000)).toThrow('safety limit')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => assertBoundedMcpPayload(circular)).toThrow('not valid serializable data')
  })

  it('turns autonomous control text into a bounded DataHub search query without Lucene operators', () => {
    expect(buildDataHubSearchQuery('Execute SAM LAB Control: objective=maintain governed graph | mode=autonomous + retry')).toBe('/q Execute+SAM+LAB+Control+objective+maintain+governed+graph+mode+autonomous+retry')
    expect(buildDataHubSearchQuery('/q Customer_Analytics_Measures')).toBe('/q Customer_Analytics_Measures')
    expect(buildDataHubSearchQuery('*')).toBe('*')
    expect(() => buildDataHubSearchQuery(':: || ++')).toThrow('searchable characters')
  })

  it('keeps complete catalog pagination bounded without silently truncating at 500 datasets', () => {
    expect(resolveCatalogSearchTotal(67)).toBe(67)
    expect(resolveCatalogSearchTotal(1_250)).toBe(1_250)
    expect(resolveCatalogSearchTotal(9_000)).toBe(2_000)
  })

  it('reconnects and retries only failed catalog pages while preserving successful pages', async () => {
    const calls = new Map<number, number>()
    const reconnect = vi.fn(async () => undefined)
    const result = await mapWithRetryConcurrency([10, 20, 30], 3, async (offset, _index, attempt) => {
      calls.set(offset, (calls.get(offset) ?? 0) + 1)
      if (offset === 20 && attempt === 1) throw new Error('search page timed out')
      return `page-${offset}`
    }, { attempts: 2, beforeRetry: reconnect, label: 'catalog pages' })

    expect(result).toEqual(['page-10', 'page-20', 'page-30'])
    expect(calls).toEqual(new Map([[10, 1], [20, 2], [30, 1]]))
    expect(reconnect).toHaveBeenCalledWith([20], 1)
  })

  it('reports the exact page after bounded catalog retries are exhausted', async () => {
    await expect(mapWithRetryConcurrency([40], 1, async () => {
      throw new Error('search page 5 attempt 2 timed out')
    }, { attempts: 2, label: 'DataHub catalog pages' })).rejects.toThrow(
      'DataHub catalog pages failed after 2 attempts (40: search page 5 attempt 2 timed out)',
    )
  })

  it('normalizes the exact write-back payload before any confirmation or MCP mutation', () => {
    expect(parseDataHubDecisionRequest({ revisionId: ' revision-1 ', title: ' Decision ', rationale: ' Because ', author: ' Operator ', relatedAssets: ['urn:li:dataset:test', 'https://malicious.test'] })).toEqual({
      revisionId: 'revision-1', title: 'Decision', rationale: 'Because', author: 'Operator', relatedAssets: ['urn:li:dataset:test'],
    })
  })
  it('falls back only to the bounded read-only allowlist when tool discovery is slow', async () => {
    const names = await resolveReadableToolNames(async () => { throw new Error('tool discovery timed out') })
    expect([...names].sort()).toEqual(['get_entities', 'get_lineage', 'list_schema_fields', 'search'])
    expect(names.has('save_document')).toBe(false)
  })

  it('advertises write-back only for an explicit non-read-only save_document tool', () => {
    expect(hasExplicitDataHubWritebackTool(undefined)).toBe(false)
    expect(hasExplicitDataHubWritebackTool({ tools: [{ name: 'save_document' }] } as never)).toBe(false)
    expect(hasExplicitDataHubWritebackTool({ tools: [{ name: 'save_document', annotations: { readOnlyHint: true } }] } as never)).toBe(false)
    expect(hasExplicitDataHubWritebackTool({ tools: [{ name: 'save_document', annotations: { readOnlyHint: false } }] } as never)).toBe(true)
    expect(getDataHubMcpConfigurationStatus().writebackAvailable).toBe(false)
  })

  it('uses the discovered tool catalog when it is available', async () => {
    const names = await resolveReadableToolNames(async () => ({ tools: [{ name: 'search' }, { name: 'custom_read' }] }))
    expect([...names]).toEqual(['search', 'custom_read'])
  })

  it('uses the current official DataHub MCP lineage contract when advertised', () => {
    const urn = 'urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)'
    expect(resolveLineageArguments({ properties: { urn: {}, upstream: {}, max_hops: {}, max_results: {} } }, urn, false)).toEqual({
      urn,
      upstream: false,
      max_hops: 3,
      max_results: 30,
    })
  })

  it('keeps compatibility with the earlier direction-based lineage contract', () => {
    const urn = 'urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)'
    expect(resolveLineageArguments({ properties: { urn: {}, direction: {}, max_hops: {}, count: {} } }, urn, true)).toEqual({
      urn,
      direction: 'upstream',
      max_hops: 3,
      count: 30,
    })
  })

  it('supports bounded per-evidence cache TTL configuration', () => {
    expect(resolveEvidenceTtlMs({
      DATAHUB_CACHE_ENTITY_TTL_MS: '10000',
      DATAHUB_CACHE_SCHEMA_TTL_MS: '2500',
      DATAHUB_CACHE_LINEAGE_TTL_MS: '99999999',
    })).toEqual({ get_entities: 10_000, list_schema_fields: 5_000, get_lineage: 3_600_000 })
  })

  it('bounds catalog summary reads separately from deep dataset inspection', () => {
    expect(resolveCatalogEntityTimeoutMs({})).toBe(8_000)
    expect(resolveCatalogEntityTimeoutMs({ DATAHUB_CATALOG_ENTITY_TIMEOUT_MS: '12000' })).toBe(12_000)
    expect(resolveCatalogEntityTimeoutMs({ DATAHUB_CATALOG_ENTITY_TIMEOUT_MS: '1000' })).toBe(5_000)
  })

  it('uses the MCP SDK timeout so expired tool calls are cancelled internally', async () => {
    const callTool = vi.fn(async () => ({ content: [] }))
    await callToolWithSdkTimeout({ callTool } as never, { name: 'get_entities', arguments: { urns: ['urn:test'] } }, 8_000, 'catalog summary')

    expect(callTool).toHaveBeenCalledWith(
      { name: 'get_entities', arguments: { urns: ['urn:test'] } },
      undefined,
      { timeout: 8_000, maxTotalTimeout: 8_000 },
    )
  })

  it('persists endpoint metadata and an encrypted token without exposing the credential', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080/', token: 'datahub-private-token' })

    electronState.availabilityChecks = 0
    const status = getDataHubMcpConfigurationStatus()
    expect(status).toMatchObject({
      mode: 'demo',
      transport: 'stdio',
      settings: { transport: 'stdio', url: 'http://localhost:8080', tokenConfigured: true, tokenSource: 'encrypted' },
    })
    expect(JSON.stringify(status)).not.toContain('datahub-private-token')
    expect(electronState.availabilityChecks).toBe(0)
    expect(electronState.decryptions).toBe(0)
    expect(readFileSync(join(directory, 'sam-lab.sqlite')).toString('utf8')).not.toContain('datahub-private-token')
  })

  it('defaults local Docker dataset reads to GraphQL and preserves an explicit MCP-only override', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    expect(getDataHubMcpConfigurationStatus().settings.catalogReadRoute).toBe('auto')

    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', catalogReadRoute: 'mcp' })
    expect(getDataHubMcpConfigurationStatus().settings.catalogReadRoute).toBe('mcp')

    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', catalogReadRoute: 'gms' })
    expect(getDataHubMcpConfigurationStatus().settings.catalogReadRoute).toBe('gms')
  })

  it('reads deep local dataset evidence through one GraphQL request without opening MCP stdio', async () => {
    const urn = 'urn:li:dataset:(urn:li:dataPlatform:dbt,orders,PROD)'
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', catalogReadRoute: 'gms' })
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      data: {
        entity: {
          urn,
          type: 'DATASET',
          name: 'orders',
          platform: { name: 'dbt' },
          properties: { description: 'Governed orders' },
          ownership: { owners: [] },
          tags: { tags: [] },
          schemaMetadata: {
            fields: [{
              fieldPath: 'order_id',
              nativeDataType: 'VARCHAR',
              tags: { tags: [{ tag: { properties: { name: 'PII' } } }] },
              glossaryTerms: { terms: [{ term: { properties: { name: 'Customer Identifier' } } }] },
            }],
          },
          editableSchemaMetadata: {
            editableSchemaFieldInfo: [{
              fieldPath: 'order_id',
              tags: { tags: [{ tag: { properties: { name: 'Restricted' } } }] },
            }],
          },
          health: [{ status: 'PASS' }],
          datasetProfiles: [{
            timestampMillis: 1_720_000_000_000,
            rowCount: 500,
            columnCount: 1,
            fieldProfiles: [{
              fieldPath: 'order_id',
              uniqueCount: 350,
              uniqueProportion: 0.7,
              nullCount: 125,
              nullProportion: 0.25,
              min: null,
              max: null,
              mean: null,
              median: null,
              stdev: null,
            }],
          }, {
            timestampMillis: 1_719_000_000_000,
            rowCount: 1_000,
            columnCount: 1,
            fieldProfiles: [{
              fieldPath: 'order_id',
              uniqueCount: 990,
              uniqueProportion: 0.99,
              nullCount: 10,
              nullProportion: 0.01,
              min: null,
              max: null,
              mean: null,
              median: null,
              stdev: null,
            }],
          }],
          upstream: { relationships: [] },
          downstream: {
            relationships: [{
              entity: {
                urn: 'urn:li:mlModel:(data_lab,churn_v3,PROD)',
                type: 'MLMODEL',
              },
            }],
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const inspection = await inspectDataHubAsset(urn, false, 'deep')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:8080/api/graphql')
    expect(inspection.asset).toMatchObject({ urn, name: 'orders', qualityStatus: 'healthy' })
    expect(inspection.asset.fields).toEqual([{ name: 'order_id', type: 'string', tags: ['PII', 'Customer Identifier', 'Restricted'] }])
    expect(inspection.asset.dataProfile).toMatchObject({
      status: 'available',
      rowCount: 500,
      previousRowCount: 1_000,
      risks: expect.arrayContaining([
        expect.objectContaining({ kind: 'volume_drop', severity: 'high' }),
        expect.objectContaining({ kind: 'null_spike', field: 'order_id', severity: 'high' }),
        expect.objectContaining({ kind: 'duplicate_drift', field: 'order_id', severity: 'high' }),
      ]),
    })
    expect(inspection.asset.downstream).toEqual([expect.objectContaining({
      urn: 'urn:li:mlModel:(data_lab,churn_v3,PROD)',
      kind: 'model',
    })])
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string }
    expect(requestBody.query).toContain('tags { tags')
    expect(requestBody.query).toContain('glossaryTerms')
    expect(requestBody.query).toContain('editableSchemaMetadata')
    expect(requestBody.query).toContain('datasetProfiles(limit: 2)')
    expect(requestBody.query).not.toContain('sampleValues')
    expect(inspection.evidence.map((read) => read.capability)).toEqual(['entity.read', 'schema.read', 'lineage.read', 'lineage.read'])
    expect(inspection.evidence.every((read) => read.summary.includes('GraphQL'))).toBe(true)
  })

  it('coalesces concurrent catalog summaries into one GraphQL entities request', async () => {
    const urns = [
      'urn:li:dataset:(urn:li:dataPlatform:dbt,orders,PROD)',
      'urn:li:dataset:(urn:li:dataPlatform:dbt,customers,PROD)',
    ]
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables: { urns: string[] } }
      return new Response(JSON.stringify({
        data: {
          entities: body.variables.urns.map((urn) => ({
            urn,
            type: 'DATASET',
            name: urn.includes('orders') ? 'orders' : 'customers',
            schemaMetadata: { fields: [] },
          })),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const inspections = await Promise.all(urns.map((urn) => inspectDataHubAsset(urn, false, 'summary')))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(inspections.map((inspection) => inspection.asset.name)).toEqual(['orders', 'customers'])
    expect(inspections.every((inspection) => inspection.evidence[0]?.capability === 'entity.read')).toBe(true)
  })

  it('preserves every bounded GraphQL search result instead of truncating pages at the MCP cap', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', catalogReadRoute: 'gms' })
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables: { input: { start: number; count: number } } }
      const { start, count } = body.variables.input
      const searchResults = Array.from({ length: Math.min(count, 500 - start) }, (_, index) => {
        const position = start + index
        return {
          entity: {
            urn: `urn:li:dataset:(urn:li:dataPlatform:dbt,dataset_${position},PROD)`,
            type: 'DATASET',
            properties: { name: `dataset_${position}` },
          },
        }
      })
      return new Response(JSON.stringify({
        data: { search: { total: 500, searchResults } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const assets = await searchDataHubAssets('*')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(assets).toHaveLength(500)
    expect(assets.at(-1)?.name).toBe('dataset_499')
  })

  it('does not silently fall back to MCP when the local GraphQL route fails', async () => {
    const urn = 'urn:li:dataset:(urn:li:dataPlatform:dbt,orders,PROD)'
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))

    const inspection = await inspectDataHubAsset(urn, true, 'summary')

    expect(inspection.evidence[0]).toMatchObject({
      capability: 'entity.read',
      status: 'error',
      stale: true,
    })
    expect(inspection.evidence[0]?.summary).toContain('HTTP 503')
  })

  it('keeps governed write-back disabled by default and persists explicit opt-in', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    expect(getDataHubMcpConfigurationStatus().settings.writebackEnabled).toBe(false)
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', writebackEnabled: true })
    expect(getDataHubMcpConfigurationStatus().settings.writebackEnabled).toBe(true)
  })

  it('rejects write-back before contacting MCP unless a human enabled it in Settings', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    await expect(writeDataHubDecision({
      revisionId: 'revision-1',
      title: 'Approved schema correction',
      rationale: 'The reviewed schema contract requires the corrected field.',
      author: 'SAM LAB operator',
      relatedAssets: ['urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)'],
    })).rejects.toThrow('write-back is disabled')
  })

  it('rotates and clears the saved token independently from the endpoint', async () => {
    await saveDataHubMcpSettings({ transport: 'http', url: 'https://mcp.example.com/mcp', token: 'first-token' })
    await saveDataHubMcpSettings({ transport: 'http', url: 'https://mcp.example.com/mcp', token: 'second-token' })
    expect(getDataHubMcpConfigurationStatus().settings.tokenConfigured).toBe(true)

    await saveDataHubMcpSettings({ transport: 'http', url: 'https://mcp.example.com/mcp', clearToken: true })
    expect(getDataHubMcpConfigurationStatus()).toMatchObject({ settings: { url: 'https://mcp.example.com/mcp', tokenConfigured: false, tokenSource: 'none' } })
  })

  it('refuses plaintext token persistence when OS encryption is unavailable', async () => {
    electronState.encryptionAvailable = false
    await expect(saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080', token: 'unsafe-token' })).rejects.toThrow('Secure credential storage is unavailable')
  })

  it('allows an unauthenticated local OSS quickstart while keeping hosted credentials optional', async () => {
    await saveDataHubMcpSettings({ transport: 'stdio', url: 'http://localhost:8080' })
    expect(getDataHubMcpConfigurationStatus()).toMatchObject({
      transport: 'stdio',
      settings: { tokenConfigured: false, tokenSource: 'none' },
      message: 'Local DataHub OSS MCP is ready without token authentication',
    })
  })
})
