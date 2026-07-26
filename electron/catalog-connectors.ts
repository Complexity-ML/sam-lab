import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { app, safeStorage } from 'electron'
import { getDataHubMcpConfigurationStatus, inspectDataHubAsset, searchDataHubAssets } from './datahub-mcp.js'
import { loadAppSetting, saveAppSetting } from './workspace-db.js'

export type CatalogConnectorKind = 'mcp' | 'http-api'

export interface CatalogConnectorManifest {
  id: string
  name: string
  kind: CatalogConnectorKind
  url: string
  enabled: boolean
  contract: 'sam-lab.catalog.v1'
  searchTool?: string
  inspectTool?: string
}

export interface CatalogConnectorSummary extends CatalogConnectorManifest {
  builtIn: boolean
  tokenConfigured: boolean
}

interface NormalizedAsset {
  connectorId: string
  sourceSystem: string
  assetRef: string
  urn: string
  name: string
  platform: string
  environment: string
  description: string
  owners: string[]
  domain?: string
  tags: string[]
  fields: { name: string; type: 'string' | 'number' | 'boolean' | 'timestamp'; tags?: string[] }[]
  qualityStatus: 'healthy' | 'failing' | 'unavailable'
  upstream: { urn: string; name: string; sensitive: boolean }[]
  downstream: { urn: string; name: string; sensitive: boolean }[]
  freshness: { capturedAt: string; expiresAt: string; stale: boolean }
}

const manifestSetting = 'catalog-connectors'
const maximumConnectors = 8
const maximumPayloadBytes = 2_000_000
const identifierPattern = /^[a-z][a-z0-9-]{1,31}$/
const toolPattern = /^[a-z0-9_.-]{1,120}$/i
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

function text(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function safeUrl(value: unknown) {
  const input = text(value, 2_000)
  const parsed = new URL(input)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopbackHosts.has(parsed.hostname))) {
    throw new Error('Connector URL must use HTTPS; HTTP is allowed only for a local loopback service')
  }
  if (parsed.username || parsed.password) throw new Error('Credentials must not be embedded in the connector URL')
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export function parseCatalogConnectorManifest(value: unknown): CatalogConnectorManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid catalog connector manifest')
  const input = value as Record<string, unknown>
  const id = text(input.id, 32)
  const name = text(input.name, 80)
  const kind = input.kind === 'mcp' || input.kind === 'http-api' ? input.kind : undefined
  const contract = input.contract === undefined || input.contract === 'sam-lab.catalog.v1' ? 'sam-lab.catalog.v1' : undefined
  const searchTool = text(input.searchTool, 120) || 'catalog_search'
  const inspectTool = text(input.inspectTool, 120) || 'catalog_inspect'
  if (!identifierPattern.test(id) || id === 'datahub') throw new Error('Connector ID must be a safe, unique identifier')
  if (!name) throw new Error('Connector name is required')
  if (!kind || !contract) throw new Error('Only the sam-lab.catalog.v1 MCP or HTTP API contract is supported')
  if (kind === 'mcp' && (!toolPattern.test(searchTool) || !toolPattern.test(inspectTool))) throw new Error('MCP tool names are invalid')
  return {
    id,
    name,
    kind,
    url: safeUrl(input.url),
    enabled: input.enabled !== false,
    contract,
    ...(kind === 'mcp' ? { searchTool, inspectTool } : {}),
  }
}

function storedManifests(): CatalogConnectorManifest[] {
  const raw = loadAppSetting(app.getPath('userData'), manifestSetting)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, maximumConnectors).flatMap((item) => {
      try { return [parseCatalogConnectorManifest(item)] } catch { return [] }
    })
  } catch {
    return []
  }
}

function tokenSetting(id: string) {
  return `catalog-token-${id}`
}

function tokenFor(id: string) {
  const encrypted = loadAppSetting(app.getPath('userData'), tokenSetting(id))
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return undefined
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim() || undefined } catch { return undefined }
}

function publicSummary(manifest: CatalogConnectorManifest): CatalogConnectorSummary {
  return { ...manifest, builtIn: false, tokenConfigured: Boolean(loadAppSetting(app.getPath('userData'), tokenSetting(manifest.id))) }
}

export function listCatalogConnectors(): CatalogConnectorSummary[] {
  const dataHub = getDataHubMcpConfigurationStatus()
  return [{
    id: 'datahub',
    name: 'DataHub',
    kind: dataHub.settings.transport === 'stdio' ? 'http-api' : 'mcp',
    url: dataHub.settings.url,
    enabled: Boolean(dataHub.settings.url),
    contract: 'sam-lab.catalog.v1',
    searchTool: dataHub.settings.transport === 'stdio' ? 'GraphQL search' : 'search',
    inspectTool: dataHub.settings.transport === 'stdio' ? 'entity.read · schema.read · lineage.read' : 'get_entities · list_schema_fields · get_lineage',
    builtIn: true,
    tokenConfigured: dataHub.settings.tokenConfigured,
  }, ...storedManifests().map(publicSummary)]
}

export function saveCatalogConnector(payload: unknown): CatalogConnectorSummary[] {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid catalog connector settings')
  const input = payload as Record<string, unknown>
  const manifest = parseCatalogConnectorManifest(input)
  const token = text(input.token, 1_000)
  if (token && !safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device')
  const current = storedManifests()
  const next = [...current.filter((item) => item.id !== manifest.id), manifest]
  if (next.length > maximumConnectors) throw new Error(`A maximum of ${maximumConnectors} custom connectors is supported`)
  saveAppSetting(app.getPath('userData'), manifestSetting, JSON.stringify(next))
  if (input.clearToken === true) saveAppSetting(app.getPath('userData'), tokenSetting(manifest.id), '')
  else if (token) saveAppSetting(app.getPath('userData'), tokenSetting(manifest.id), safeStorage.encryptString(token).toString('base64'))
  return listCatalogConnectors()
}

export function deleteCatalogConnector(idValue: unknown): CatalogConnectorSummary[] {
  const id = text(idValue, 32)
  if (!identifierPattern.test(id) || id === 'datahub') throw new Error('Invalid custom connector ID')
  saveAppSetting(app.getPath('userData'), manifestSetting, JSON.stringify(storedManifests().filter((item) => item.id !== id)))
  saveAppSetting(app.getPath('userData'), tokenSetting(id), '')
  return listCatalogConnectors()
}

function boundedJson(value: unknown, label: string) {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > maximumPayloadBytes) throw new Error(`${label} exceeded the 2 MB safety limit`)
  return value
}

function structuredToolPayload(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('MCP connector returned an invalid response')
  const result = value as { isError?: boolean; structuredContent?: unknown; content?: { type?: string; text?: string }[] }
  if (result.isError) throw new Error('MCP connector tool returned an error')
  if (result.structuredContent !== undefined) return boundedJson(result.structuredContent, 'MCP connector response')
  const textContent = result.content?.find((item) => item.type === 'text' && typeof item.text === 'string')?.text
  if (!textContent) throw new Error('MCP connector did not return structured JSON')
  return boundedJson(JSON.parse(textContent), 'MCP connector response')
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : []
}

function lineage(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    const urn = text(entry.assetRef ?? entry.urn, 2_000)
    if (!urn) return []
    return [{ urn, name: text(entry.name, 200) || urn, sensitive: entry.sensitive === true }]
  })
}

function normalizeAsset(value: unknown, connector: CatalogConnectorManifest): NormalizedAsset {
  if (!value || typeof value !== 'object') throw new Error(`${connector.name} returned an invalid catalog asset`)
  const input = value as Record<string, unknown>
  const assetRef = text(input.assetRef ?? input.ref ?? input.urn, 2_000)
  const name = text(input.name, 240)
  if (!assetRef || !name) throw new Error(`${connector.name} assets require assetRef and name`)
  const now = new Date().toISOString()
  const freshness = input.freshness && typeof input.freshness === 'object' ? input.freshness as Record<string, unknown> : {}
  const fields = Array.isArray(input.fields) ? input.fields.slice(0, 2_000).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const field = item as Record<string, unknown>
    const fieldName = text(field.name, 240)
    const type = ['string', 'number', 'boolean', 'timestamp'].includes(String(field.type)) ? field.type as 'string' | 'number' | 'boolean' | 'timestamp' : 'string'
    return fieldName ? [{ name: fieldName, type, tags: stringList(field.tags) }] : []
  }) : []
  return {
    connectorId: connector.id,
    sourceSystem: connector.name,
    assetRef,
    urn: assetRef,
    name,
    platform: text(input.platform, 120) || connector.name,
    environment: text(input.environment, 120) || 'unknown',
    description: text(input.description, 4_000),
    owners: stringList(input.owners),
    domain: text(input.domain, 240) || undefined,
    tags: stringList(input.tags),
    fields,
    qualityStatus: input.qualityStatus === 'healthy' || input.qualityStatus === 'failing' ? input.qualityStatus : 'unavailable',
    upstream: lineage(input.upstream),
    downstream: lineage(input.downstream),
    freshness: {
      capturedAt: text(freshness.capturedAt, 80) || now,
      expiresAt: text(freshness.expiresAt, 80) || now,
      stale: freshness.stale !== false,
    },
  }
}

function assetsFromPayload(payload: unknown, connector: CatalogConnectorManifest) {
  const value = payload && typeof payload === 'object' && 'assets' in payload ? (payload as { assets?: unknown }).assets : payload
  if (!Array.isArray(value)) throw new Error(`${connector.name} search must return an assets array`)
  return value.slice(0, 2_000).map((item) => normalizeAsset(item, connector))
}

async function fetchJson(url: URL, token?: string) {
  if (token && url.protocol !== 'https:' && !loopbackHosts.has(url.hostname)) throw new Error('Refusing to send a connector token over insecure HTTP')
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.origin}`)
  return boundedJson(await response.json(), 'HTTP connector response')
}

async function withMcp<T>(connector: CatalogConnectorManifest, operation: (client: Client) => Promise<T>) {
  const token = tokenFor(connector.id)
  const endpoint = new URL(connector.url)
  if (token && endpoint.protocol !== 'https:' && !loopbackHosts.has(endpoint.hostname)) throw new Error('Refusing to send a connector token over insecure HTTP')
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : undefined } })
  const client = new Client({ name: 'sam-lab-catalog', version: app.getVersion() })
  try {
    await client.connect(transport)
    return await operation(client)
  } finally {
    await transport.close().catch(() => undefined)
  }
}

async function searchExternal(connector: CatalogConnectorManifest, query: string) {
  if (connector.kind === 'http-api') {
    const url = new URL('/catalog/search', connector.url)
    url.searchParams.set('q', query)
    return assetsFromPayload(await fetchJson(url, tokenFor(connector.id)), connector)
  }
  return withMcp(connector, async (client) => assetsFromPayload(structuredToolPayload(await client.callTool({
    name: connector.searchTool ?? 'catalog_search',
    arguments: { query, limit: 2_000 },
  })), connector))
}

async function inspectExternal(connector: CatalogConnectorManifest, assetRef: string) {
  const capturedAt = new Date().toISOString()
  const payload = connector.kind === 'http-api'
    ? await (() => {
        const url = new URL('/catalog/assets', connector.url)
        url.searchParams.set('ref', assetRef)
        return fetchJson(url, tokenFor(connector.id))
      })()
    : await withMcp(connector, async (client) => structuredToolPayload(await client.callTool({
        name: connector.inspectTool ?? 'catalog_inspect',
        arguments: { asset_ref: assetRef },
      })))
  const rawAsset = payload && typeof payload === 'object' && 'asset' in payload ? (payload as { asset?: unknown }).asset : payload
  const asset = normalizeAsset(rawAsset, connector)
  return {
    asset,
    evidence: [{
      connectorId: connector.id,
      sourceSystem: connector.name,
      tool: connector.kind === 'mcp' ? connector.inspectTool ?? 'catalog_inspect' : 'GET /catalog/assets',
      assetRef,
      urn: assetRef,
      capturedAt,
      expiresAt: asset.freshness.expiresAt,
      status: 'ok' as const,
      summary: `${connector.name} returned normalized catalog.v1 metadata for ${asset.name}`,
      cached: false,
      stale: asset.freshness.stale,
    }],
  }
}

export async function testCatalogConnector(idValue: unknown) {
  const id = text(idValue, 32)
  const connector = storedManifests().find((item) => item.id === id)
  if (!connector) throw new Error('Catalog connector was not found')
  if (connector.kind === 'http-api') {
    await searchExternal(connector, '*')
    return { connected: true, message: `${connector.name} implements sam-lab.catalog.v1` }
  }
  return withMcp(connector, async (client) => {
    const tools = await client.listTools()
    const names = new Set(tools.tools.map((tool) => tool.name))
    if (!names.has(connector.searchTool ?? 'catalog_search') || !names.has(connector.inspectTool ?? 'catalog_inspect')) throw new Error('Required catalog.v1 MCP tools are missing')
    return { connected: true, message: `${connector.name} exposes the normalized catalog tools` }
  })
}

export async function searchCatalogAssets(queryValue: unknown) {
  const query = text(queryValue, 500)
  if (!query) throw new Error('A catalog search query is required')
  const dataHubStatus = getDataHubMcpConfigurationStatus()
  const connectors = storedManifests().filter((item) => item.enabled)
  const operations: Promise<NormalizedAsset[]>[] = connectors.map((connector) => searchExternal(connector, query))
  if (dataHubStatus.settings.url) operations.unshift(searchDataHubAssets(query).then((assets) => assets.map((asset) => ({
    ...asset,
    connectorId: 'datahub',
    sourceSystem: 'DataHub',
    assetRef: asset.urn,
  }))))
  if (!operations.length) throw new Error('Configure at least one enabled catalog connection')
  const settled = await Promise.allSettled(operations)
  const assets = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  if (!assets.length) {
    const errors = settled.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : [])
    throw new Error(`Catalog search failed · ${errors.join(' · ')}`)
  }
  const seen = new Set<string>()
  return assets.filter((asset) => {
    const key = `${asset.connectorId}:${asset.assetRef}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function inspectCatalogAsset(connectorIdValue: unknown, assetRefValue: unknown, force = false, modeValue: unknown = 'deep') {
  const connectorId = text(connectorIdValue, 32) || 'datahub'
  const assetRef = text(assetRefValue, 2_000)
  const mode = modeValue === 'summary' ? 'summary' : 'deep'
  if (!assetRef) throw new Error('A catalog asset reference is required')
  if (connectorId === 'datahub') {
    const inspection = await inspectDataHubAsset(assetRef, force, mode)
    return {
      asset: { ...inspection.asset, connectorId: 'datahub', sourceSystem: 'DataHub', assetRef },
      evidence: inspection.evidence.map((read) => ({ ...read, tool: read.name, connectorId: 'datahub', sourceSystem: 'DataHub', assetRef, urn: assetRef })),
    }
  }
  const connector = storedManifests().find((item) => item.id === connectorId && item.enabled)
  if (!connector) throw new Error('Catalog connector is disabled or unavailable')
  return inspectExternal(connector, assetRef)
}
