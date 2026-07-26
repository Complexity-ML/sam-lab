import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { entityUrns, parseAssetContext, parseSearchResults, parseSearchTotal, readStructuredToolResult, sanitizeEvidenceSummary, type DataHubAssetSummary } from './datahub-context.js'
import { BoundedTaskPool, dataHubMcpReadLimit } from './mcp-read-limiter.js'
import { loadAppSetting, saveAppSetting } from './workspace-db.js'
import { secureStorageCapability } from './secure-storage.js'
export type { DataHubAssetSummary } from './datahub-context.js'

export type DataHubMcpTransport = 'demo' | 'http' | 'stdio'
export type DataHubCatalogReadRoute = 'auto' | 'gms' | 'mcp'

export interface DataHubMcpStatus {
  mode: 'demo' | 'connected'
  transport: DataHubMcpTransport
  message: string
  serverVersion?: string
  toolCount: number
  tools: string[]
  writebackAvailable: boolean
  settings: DataHubMcpPublicSettings
}

export interface DataHubMcpPublicSettings {
  transport: 'http' | 'stdio'
  url: string
  catalogReadRoute?: DataHubCatalogReadRoute
  tokenConfigured: boolean
  tokenSource: 'encrypted' | 'environment' | 'none'
  encryptionAvailable: boolean
  writebackEnabled: boolean
}

export interface DataHubMcpRead {
  name: 'get_entities' | 'list_schema_fields' | 'get_lineage'
  capability?: 'entity.read' | 'schema.read' | 'lineage.read'
  status: 'ok' | 'unavailable' | 'error'
  summary: string
  capturedAt: string
  expiresAt: string
  cached: boolean
  stale: boolean
}

export interface DataHubMcpAudit {
  urn: string
  transport: Exclude<DataHubMcpTransport, 'demo'>
  route?: 'gms-graphql' | 'mcp'
  serverVersion?: string
  reads: DataHubMcpRead[]
  asset?: DataHubAssetSummary
}

type ActiveTransport = StdioClientTransport | StreamableHTTPClientTransport

let activeClient: Client | undefined
let activeTransport: ActiveTransport | undefined
let activeMode: Exclude<DataHubMcpTransport, 'demo'> | undefined
let connectionPromise: Promise<Client> | undefined
type ToolCatalog = Awaited<ReturnType<Client['listTools']>>
let toolCatalog: ToolCatalog | undefined
let toolDiscoveryPromise: Promise<ToolCatalog> | undefined
const contextCache = new Map<string, { result: unknown; capturedAt: number; expiresAt: number }>()
const knownReadTools = new Set(['search', 'get_entities', 'list_schema_fields', 'get_lineage'])
const maxMcpResultBytes = 2_000_000
const maxMcpCatalogBytes = 512_000
const mcpReadPools = {
  http: new BoundedTaskPool(dataHubMcpReadLimit('http')),
  stdio: new BoundedTaskPool(dataHubMcpReadLimit('stdio')),
}
const defaultEvidenceTtlMs: Record<DataHubMcpRead['name'], number> = {
  get_entities: 5 * 60_000,
  list_schema_fields: 2 * 60_000,
  get_lineage: 90_000,
}

const evidenceCapability: Record<DataHubMcpRead['name'], NonNullable<DataHubMcpRead['capability']>> = {
  get_entities: 'entity.read',
  list_schema_fields: 'schema.read',
  get_lineage: 'lineage.read',
}

export type DataHubInspectionMode = 'summary' | 'deep'

export function hasExplicitDataHubWritebackTool(catalog: ToolCatalog | undefined): boolean {
  const tool = catalog?.tools.find((candidate) => candidate.name === 'save_document')
  return Boolean(tool && tool.annotations?.readOnlyHint === false)
}

function boundedTtl(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(60 * 60_000, Math.max(5_000, Math.round(parsed))) : fallback
}

export function resolveEvidenceTtlMs(environment: NodeJS.ProcessEnv = process.env): Record<DataHubMcpRead['name'], number> {
  return {
    get_entities: boundedTtl(environment.DATAHUB_CACHE_ENTITY_TTL_MS, defaultEvidenceTtlMs.get_entities),
    list_schema_fields: boundedTtl(environment.DATAHUB_CACHE_SCHEMA_TTL_MS, defaultEvidenceTtlMs.list_schema_fields),
    get_lineage: boundedTtl(environment.DATAHUB_CACHE_LINEAGE_TTL_MS, defaultEvidenceTtlMs.get_lineage),
  }
}

export function resolveCatalogEntityTimeoutMs(environment: NodeJS.ProcessEnv = process.env) {
  return boundedTtl(environment.DATAHUB_CATALOG_ENTITY_TIMEOUT_MS, 8_000)
}

export function resolveDataHubMcpCommand(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
  pathExists: (path: string) => boolean = existsSync,
) {
  const configured = environment.DATAHUB_MCP_COMMAND?.trim()
  if (configured && configured !== 'uvx' && configured !== 'uvx.exe') return configured
  const executable = platform === 'win32' ? 'uvx.exe' : 'uvx'
  const path = platform === 'win32' ? win32 : posix
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const pathCandidates = (environment.PATH ?? '').split(pathDelimiter).filter(Boolean).map((directory) => path.join(directory, executable))
  const commonCandidates = platform === 'win32'
    ? [
        environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'Programs', 'uv', executable) : '',
        path.join(home, '.local', 'bin', executable),
        path.join(home, '.cargo', 'bin', executable),
      ]
    : [
        path.join(home, '.local', 'bin', executable),
        path.join(home, '.cargo', 'bin', executable),
        '/opt/homebrew/bin/uvx',
        '/usr/local/bin/uvx',
        '/usr/bin/uvx',
      ]
  return [...pathCandidates, ...commonCandidates].find((candidate) => candidate && pathExists(candidate)) ?? executable
}

export function normalizeDataHubMcpStartupError(error: unknown, command: string) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOENT' || /\bENOENT\b/.test(message)) {
    return new Error(`Local DataHub MCP could not start because "${command}" was not found. Install uv, restart SAM LAB, then connect again.`)
  }
  return error instanceof Error ? error : new Error(message)
}

const settingKeys = {
  transport: 'datahub-mcp-transport',
  url: 'datahub-mcp-url',
  catalogReadRoute: 'datahub-catalog-read-route',
  token: 'datahub-mcp-token',
  writeback: 'datahub-mcp-writeback',
} as const

function validateDatasetUrn(urn: string) {
  if (!urn.startsWith('urn:li:dataset:') || urn.length > 2_000) throw new Error('A valid DataHub dataset URN is required')
}

export function assertBoundedMcpPayload<T>(value: T, label = 'DataHub MCP response', maxBytes = maxMcpResultBytes): T {
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { throw new Error(`${label} is not valid serializable data`) }
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > maxBytes) throw new Error(`${label} exceeded the ${maxBytes}-byte safety limit`)
  return value
}

function safeToolName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 120 && /^[a-z0-9_.-]+$/i.test(value)
}

function decryptStoredToken(encrypted: string | null): string | undefined {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return undefined
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')).trim() || undefined } catch { return undefined }
}

function configuration(resolveSecrets = false): { mode: DataHubMcpTransport; message: string; url?: string; token?: string; settings: DataHubMcpPublicSettings } {
  const userData = app.getPath('userData')
  const storedTransport = loadAppSetting(userData, settingKeys.transport)
  const storedUrl = loadAppSetting(userData, settingKeys.url)?.trim()
  const encryptedToken = loadAppSetting(userData, settingKeys.token)
  const storedToken = resolveSecrets ? decryptStoredToken(encryptedToken) : undefined
  const transport = storedTransport === 'stdio' || storedTransport === 'http' ? storedTransport : undefined
  const environmentHttpUrl = process.env.DATAHUB_MCP_URL?.trim()
  const environmentGmsUrl = process.env.DATAHUB_GMS_URL?.trim()
  const environmentToken = (process.env.DATAHUB_MCP_TOKEN ?? process.env.DATAHUB_GMS_TOKEN)?.trim()
  const selectedTransport = transport ?? (environmentHttpUrl ? 'http' : 'stdio')
  const url = storedUrl || (selectedTransport === 'http' ? environmentHttpUrl : environmentGmsUrl) || ''
  const token = storedToken || environmentToken
  const tokenConfigured = Boolean(encryptedToken || environmentToken)
  const writebackEnabled = loadAppSetting(userData, settingKeys.writeback) === 'true'
  const storedCatalogReadRoute = loadAppSetting(userData, settingKeys.catalogReadRoute)
  const environmentCatalogReadRoute = process.env.DATAHUB_CATALOG_READ_ROUTE?.trim()
  const catalogReadRoute: DataHubCatalogReadRoute = selectedTransport === 'http' ? 'mcp' : (
    storedCatalogReadRoute === 'gms' || storedCatalogReadRoute === 'mcp' || storedCatalogReadRoute === 'auto'
      ? storedCatalogReadRoute
      : environmentCatalogReadRoute === 'gms' || environmentCatalogReadRoute === 'mcp'
        ? environmentCatalogReadRoute
        : 'auto'
  )
  const settings: DataHubMcpPublicSettings = {
    transport: selectedTransport,
    url,
    catalogReadRoute,
    tokenConfigured,
    tokenSource: encryptedToken ? 'encrypted' : environmentToken ? 'environment' : 'none',
    encryptionAvailable: secureStorageCapability(),
    writebackEnabled,
  }

  if (selectedTransport === 'http' && url) {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DATAHUB_MCP_URL must use http or https')
    return { mode: 'http', message: `Remote MCP configured at ${parsed.origin}`, url, token, settings }
  }

  if (selectedTransport === 'stdio' && url) return {
    mode: 'stdio',
    message: tokenConfigured ? 'Local DataHub MCP is ready with token authentication' : 'Local DataHub OSS MCP is ready without token authentication',
    url,
    token,
    settings,
  }

  return {
    mode: 'demo',
    message: 'Configure the DataHub connection below, then connect.',
    settings,
  }
}

function createTransport(): { mode: Exclude<DataHubMcpTransport, 'demo'>; transport: ActiveTransport; command?: string } {
  const config = configuration(true)
  if (config.mode === 'demo') throw new Error(config.message)
  if (config.mode === 'http') {
    const headers = config.token ? { Authorization: `Bearer ${config.token}` } : undefined
    return {
      mode: 'http',
      transport: new StreamableHTTPClientTransport(new URL(config.url!), { requestInit: { headers } }),
    }
  }

  const command = resolveDataHubMcpCommand()
  return {
    mode: 'stdio',
    command,
    transport: new StdioClientTransport({
      command,
      args: [process.env.DATAHUB_MCP_PACKAGE?.trim() || 'mcp-server-datahub@latest'],
      env: {
        ...getDefaultEnvironment(),
        DATAHUB_GMS_URL: config.url!,
        ...(config.token ? { DATAHUB_GMS_TOKEN: config.token } : {}),
        TOOLS_IS_MUTATION_ENABLED: config.settings.writebackEnabled ? 'true' : 'false',
      },
      stderr: 'pipe',
    }),
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1_000}s`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function callToolWithSdkTimeout(
  client: Pick<Client, 'callTool'>,
  params: Parameters<Client['callTool']>[0],
  timeoutMs: number,
  label: string,
) {
  try {
    return await client.callTool(params, undefined, {
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed?\s*out|timeout/i.test(message)) {
      throw new Error(`${label} timed out after ${timeoutMs / 1_000}s`)
    }
    throw error
  }
}

async function connectClient(): Promise<Client> {
  if (activeClient) return activeClient
  if (connectionPromise) return connectionPromise

  connectionPromise = (async () => {
    const client = new Client({ name: 'sam-lab', version: '0.1.0' })
    const configured = createTransport()
    try {
      await withTimeout(client.connect(configured.transport), 30_000, 'DataHub MCP connection')
      activeClient = client
      activeTransport = configured.transport
      activeMode = configured.mode
      return client
    } catch (error) {
      await configured.transport.close().catch(() => undefined)
      throw configured.mode === 'stdio'
        ? normalizeDataHubMcpStartupError(error, configured.command ?? 'uvx')
        : error
    } finally {
      connectionPromise = undefined
    }
  })()

  return connectionPromise
}

async function discoverTools(client: Client, label = 'DataHub MCP tool discovery', timeoutMs = 12_000): Promise<ToolCatalog> {
  if (toolCatalog) return toolCatalog
  if (!toolDiscoveryPromise) {
    const pending = client.listTools().then((catalog) => {
      assertBoundedMcpPayload(catalog, 'DataHub MCP tool catalog', maxMcpCatalogBytes)
      toolCatalog = catalog
      return catalog
    })
    toolDiscoveryPromise = pending
    void pending.finally(() => { if (toolDiscoveryPromise === pending) toolDiscoveryPromise = undefined }).catch(() => undefined)
  }
  return withTimeout(toolDiscoveryPromise, timeoutMs, label)
}

export async function resolveReadableToolNames(discovery: () => Promise<{ tools: { name: string }[] }>): Promise<Set<string>> {
  try {
    const catalog = await discovery()
    return new Set(catalog.tools.map((tool) => tool.name).filter(safeToolName))
  } catch {
    // Read calls have their own timeouts and return bounded error evidence. A slow
    // listTools response must not block known read-only DataHub operations.
    return new Set(knownReadTools)
  }
}

export function resolveLineageArguments(inputSchema: unknown, urn: string, upstream: boolean): Record<string, unknown> {
  const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema as Record<string, unknown> : {}
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, unknown>
    : {}
  const modern = Object.keys(properties).length === 0 || 'upstream' in properties || 'max_results' in properties

  return {
    urn,
    max_hops: 3,
    ...(modern
      ? { upstream, max_results: 30 }
      : { direction: upstream ? 'upstream' : 'downstream', count: 30 }),
  }
}

async function discoverReadableToolNames(client: Client): Promise<Set<string>> {
  return resolveReadableToolNames(() => discoverTools(client))
}

export function getDataHubMcpConfigurationStatus(): DataHubMcpStatus {
  const config = configuration()
  if (config.mode === 'demo') return { mode: 'demo', transport: 'demo', message: config.message, toolCount: 0, tools: [], writebackAvailable: false, settings: config.settings }
  const tools = toolCatalog?.tools.map((tool) => tool.name).filter(safeToolName).sort() ?? []
  return {
    mode: activeClient ? 'connected' : 'demo',
    transport: config.mode,
    message: activeClient ? `DataHub MCP connected${tools.length ? ` · ${tools.length} tools available` : ''}` : config.message,
    toolCount: tools.length,
    tools,
    writebackAvailable: config.mode === 'stdio' && Boolean(config.url) ? true : Boolean(activeClient) && hasExplicitDataHubWritebackTool(toolCatalog),
    settings: config.settings,
  }
}

export async function saveDataHubMcpSettings(payload: unknown): Promise<DataHubMcpStatus> {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid DataHub connection settings')
  const value = payload as Record<string, unknown>
  const transport = value.transport === 'http' || value.transport === 'stdio' ? value.transport : undefined
  const url = typeof value.url === 'string' ? value.url.trim().replace(/\/$/, '') : ''
  const token = typeof value.token === 'string' ? value.token.trim() : ''
  if (!transport) throw new Error('Choose HTTP or local stdio transport')
  if (!url || url.length > 2_000) throw new Error('A DataHub URL is required')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DataHub URL must use http or https')
  if (token.length > 1_000) throw new Error('DataHub token is too long')
  if (token && !safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device')

  const userData = app.getPath('userData')
  saveAppSetting(userData, settingKeys.transport, transport)
  saveAppSetting(userData, settingKeys.url, url)
  const catalogReadRoute = transport === 'http'
    ? 'mcp'
    : value.catalogReadRoute === 'gms' || value.catalogReadRoute === 'mcp'
      ? value.catalogReadRoute
      : 'auto'
  saveAppSetting(userData, settingKeys.catalogReadRoute, catalogReadRoute)
  saveAppSetting(userData, settingKeys.writeback, value.writebackEnabled === true ? 'true' : 'false')
  if (value.clearToken === true) saveAppSetting(userData, settingKeys.token, '')
  else if (token) saveAppSetting(userData, settingKeys.token, safeStorage.encryptString(token).toString('base64'))
  await closeDataHubMcp()
  return getDataHubMcpConfigurationStatus()
}

export async function connectDataHubMcp(): Promise<DataHubMcpStatus> {
  const config = configuration()
  if (config.mode === 'demo') return getDataHubMcpConfigurationStatus()
  const client = await connectClient()
  let tools: ToolCatalog | undefined
  try {
    tools = await discoverTools(client, 'DataHub MCP initial tool discovery', 5_000)
  } catch {
    // A successful MCP handshake remains usable even when listTools is slow.
    // Known reads have their own bounded calls and tool discovery keeps running
    // in the background, so the UI must not remain stuck in "Connecting".
    const names = [...knownReadTools].sort()
    return {
      mode: 'connected',
      transport: activeMode ?? config.mode,
      message: `DataHub MCP connected · tool discovery delayed · ${names.length} bounded read tools ready`,
      serverVersion: client.getServerVersion()?.version,
      toolCount: names.length,
      tools: names,
      writebackAvailable: config.mode === 'stdio' && Boolean(config.url),
      settings: config.settings,
    }
  }
  const names = tools.tools.map((tool) => tool.name).filter(safeToolName).sort()
  return {
    mode: 'connected',
    transport: activeMode ?? config.mode,
    message: `DataHub MCP connected · ${names.length} tools available`,
    serverVersion: client.getServerVersion()?.version,
    toolCount: names.length,
    tools: names,
    writebackAvailable: config.mode === 'stdio' && Boolean(config.url) ? true : hasExplicitDataHubWritebackTool(tools),
    settings: config.settings,
  }
}

function summarizeResult(result: unknown): string {
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const structured = value.structuredContent ? JSON.stringify(value.structuredContent) : ''
  const content = Array.isArray(value.content) ? value.content : []
  const text = content
    .filter((item): item is { type: 'text'; text: string } => Boolean(item) && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join(' ')
  const compact = (structured || text || (value.isError ? 'MCP tool returned an error' : 'Context received')).replace(/\s+/g, ' ').trim()
  const sanitized = sanitizeEvidenceSummary(compact)
  return sanitized.length > 320 ? `${sanitized.slice(0, 317)}…` : sanitized
}

function runBoundedMcpRead<T>(task: () => Promise<T>) {
  return mcpReadPools[activeMode ?? 'stdio'].run(task)
}

async function readCachedTool(options: { client: Client; available: Set<string>; urn: string; name: DataHubMcpRead['name']; arguments: Record<string, unknown>; force?: boolean }) {
  const { client, available, name, urn } = options
  const now = Date.now()
  const cacheKey = `${name}:${JSON.stringify(options.arguments)}`
  const cached = contextCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > now) return {
    result: cached.result,
      evidence: { name, capability: evidenceCapability[name], status: 'ok' as const, summary: summarizeResult(cached.result), capturedAt: new Date(cached.capturedAt).toISOString(), expiresAt: new Date(cached.expiresAt).toISOString(), cached: true, stale: false },
  }
  const capturedAt = new Date(now).toISOString()
  if (!available.has(name)) return {
    result: undefined,
    evidence: { name, capability: evidenceCapability[name], status: 'unavailable' as const, summary: 'Tool is not exposed by this MCP server.', capturedAt, expiresAt: capturedAt, cached: false, stale: true },
  }
  try {
    const result = assertBoundedMcpPayload(await runBoundedMcpRead(
      () => callToolWithSdkTimeout(client, { name, arguments: options.arguments }, 20_000, name),
    ), `${name} response`)
    const status = result.isError ? 'error' as const : 'ok' as const
    const expiresAt = now + resolveEvidenceTtlMs()[name]
    if (status === 'ok') contextCache.set(cacheKey, { result, capturedAt: now, expiresAt })
    return {
      result,
      evidence: { name, capability: evidenceCapability[name], status, summary: summarizeResult(result), capturedAt, expiresAt: new Date(expiresAt).toISOString(), cached: false, stale: status !== 'ok' },
    }
  } catch (error) {
    return {
      result: undefined,
      evidence: { name, capability: evidenceCapability[name], status: 'error' as const, summary: `${error instanceof Error ? error.message : 'Unknown MCP error'} (${urn})`, capturedAt, expiresAt: capturedAt, cached: false, stale: true },
    }
  }
}

function cachedEntityRead(urn: string, force: boolean) {
  const now = Date.now()
  const cacheKey = `get_entities:${JSON.stringify({ urns: [urn] })}`
  const cached = contextCache.get(cacheKey)
  if (force || !cached || cached.expiresAt <= now) return undefined
  return {
    result: cached.result,
    evidence: {
      name: 'get_entities' as const,
      capability: 'entity.read' as const,
      status: 'ok' as const,
      summary: summarizeResult(cached.result),
      capturedAt: new Date(cached.capturedAt).toISOString(),
      expiresAt: new Date(cached.expiresAt).toISOString(),
      cached: true,
      stale: false,
    },
  }
}

const catalogEntitiesQuery = `query DataLabCatalogEntities($urns: [String!]!) {
  entities(urns: $urns) {
    urn
    type
    ... on Dataset {
      name
      platform { urn name }
      properties { name description }
      editableProperties { description }
      ownership {
        owners {
          owner {
            ... on CorpUser { urn username }
            ... on CorpGroup { urn name }
          }
        }
      }
      tags { tags { tag { urn name properties { name } } } }
      schemaMetadata {
        fields {
          fieldPath
          nativeDataType
          tags { tags { tag { urn name properties { name } } } }
          glossaryTerms { terms { term { urn properties { name } } } }
        }
      }
      editableSchemaMetadata {
        editableSchemaFieldInfo {
          fieldPath
          tags { tags { tag { urn name properties { name } } } }
          glossaryTerms { terms { term { urn properties { name } } } }
        }
      }
      datasetProfiles(limit: 2) {
        timestampMillis
        rowCount
        columnCount
        fieldProfiles {
          fieldPath
          uniqueCount
          uniqueProportion
          nullCount
          nullProportion
          min
          max
          mean
          median
          stdev
        }
      }
      health { type status message }
    }
  }
}`

const gmsCatalogCircuit = { failures: 0, openUntil: 0 }

function catalogGraphqlEndpoint(url: string) {
  const parsed = new URL(url)
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/graphql`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

async function postDataHubGraphql<T>(config: ReturnType<typeof configuration>, query: string, variables: Record<string, unknown>, label: string): Promise<T> {
  if (config.mode !== 'stdio' || !config.url) throw new Error('Direct GMS catalog reads require a local stdio DataHub connection')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), resolveCatalogEntityTimeoutMs())
  try {
    const response = await fetch(catalogGraphqlEndpoint(config.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`DataHub GMS GraphQL returned HTTP ${response.status}`)
    const payload = assertBoundedMcpPayload(await response.json(), label)
    if (!payload || typeof payload !== 'object') throw new Error('DataHub GMS GraphQL returned an invalid response')
    const value = payload as { data?: T; errors?: { message?: unknown }[] }
    if (value.errors?.length) {
      const message = value.errors.map((error) => sanitizeEvidenceSummary(String(error.message ?? 'GraphQL error'))).join(' · ')
      throw new Error(message.slice(0, 1_000))
    }
    if (!value.data) throw new Error('DataHub GMS GraphQL returned no data')
    return value.data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`DataHub GMS GraphQL timed out after ${resolveCatalogEntityTimeoutMs() / 1_000}s`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readEntityBatchFromGms(urns: string[], config: ReturnType<typeof configuration>) {
  const data = await postDataHubGraphql<{ entities?: unknown[] }>(
    config,
    catalogEntitiesQuery,
    { urns },
    'DataHub GMS GraphQL entity response',
  )
  const entities = Array.isArray(data.entities) ? data.entities : []
    const byUrn = new Map(entities.flatMap((entity) => {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return []
      const entityUrn = (entity as { urn?: unknown }).urn
      return typeof entityUrn === 'string' && urns.includes(entityUrn) ? [[entityUrn, entity] as const] : []
    }))
  return byUrn
}

async function readEntityBatchViaGms(urns: string[], reads: Map<string, Awaited<ReturnType<typeof readCachedTool>>>) {
  const config = configuration(true)
  const entities = await readEntityBatchFromGms(urns, config)
  const capturedAtMs = Date.now()
  const capturedAt = new Date(capturedAtMs).toISOString()
  const expiresAtMs = capturedAtMs + resolveEvidenceTtlMs().get_entities
  for (const urn of urns) {
    const entity = entities.get(urn)
    if (!entity) throw new Error(`DataHub GMS GraphQL omitted ${urn}`)
    const result = { structuredContent: { result: [entity] } }
    contextCache.set(`get_entities:${JSON.stringify({ urns: [urn] })}`, { result, capturedAt: capturedAtMs, expiresAt: expiresAtMs })
    reads.set(urn, {
      result,
      evidence: {
        name: 'get_entities',
        capability: 'entity.read',
        status: 'ok',
        summary: 'Catalog entity summary received from DataHub GMS GraphQL.',
        capturedAt,
        expiresAt: new Date(expiresAtMs).toISOString(),
        cached: false,
        stale: false,
      },
    })
  }
}

async function readEntityBatch(urns: string[], force: boolean) {
  const reads = new Map<string, Awaited<ReturnType<typeof readCachedTool>>>()
  const missing: string[] = []
  for (const urn of urns) {
    const cached = cachedEntityRead(urn, force)
    if (cached) reads.set(urn, cached)
    else missing.push(urn)
  }
  if (!missing.length) return reads

  const config = configuration(true)
  const route = config.settings.catalogReadRoute ?? 'auto'
  const mayUseGms = config.mode === 'stdio' && Boolean(config.url) && route !== 'mcp'
  if (mayUseGms) {
    try {
      if (Date.now() < gmsCatalogCircuit.openUntil) throw new Error('DataHub GMS GraphQL is cooling down after a recent transport failure')
      await readEntityBatchViaGms(missing, reads)
      gmsCatalogCircuit.failures = 0
      gmsCatalogCircuit.openUntil = 0
      return reads
    } catch (error) {
      gmsCatalogCircuit.failures += 1
      gmsCatalogCircuit.openUntil = Date.now() + Math.min(60_000, 5_000 * (2 ** Math.min(3, gmsCatalogCircuit.failures - 1)))
      const capturedAt = new Date().toISOString()
      for (const urn of missing) reads.set(urn, {
        result: undefined,
        evidence: {
          name: 'get_entities',
          capability: 'entity.read',
          status: 'error',
          summary: `${error instanceof Error ? error.message : 'Unknown GMS GraphQL error'} (${urn})`,
          capturedAt,
          expiresAt: capturedAt,
          cached: false,
          stale: true,
        },
      })
      return reads
    }
  }

  const client = await connectClient()
  const available = await discoverReadableToolNames(client)
  const capturedAt = new Date().toISOString()
  if (!available.has('get_entities')) {
    for (const urn of missing) reads.set(urn, {
      result: undefined,
      evidence: { name: 'get_entities', capability: 'entity.read', status: 'unavailable', summary: 'Tool is not exposed by this MCP server.', capturedAt, expiresAt: capturedAt, cached: false, stale: true },
    })
    return reads
  }

  // DataHub MCP currently loops over array arguments internally and performs
  // several GraphQL reads per URN. A slow entity can therefore time out the
  // whole apparent "batch". Isolate catalog summaries so healthy entities
  // finish independently and the failed URN can be deferred.
  const fetched = await mapWithConcurrency(missing, 2, async (urn) => {
    const capturedAtMs = Date.now()
    const entityCapturedAt = new Date(capturedAtMs).toISOString()
    try {
      const result = assertBoundedMcpPayload(await runBoundedMcpRead(
        () => callToolWithSdkTimeout(
          client,
          { name: 'get_entities', arguments: { urns: [urn] } },
          resolveCatalogEntityTimeoutMs(),
          'get_entities catalog summary',
        ),
      ), 'get_entities catalog summary response')
      if (result.isError) throw new Error(summarizeResult(result))
      const returned = entityUrns(readStructuredToolResult(result))
      if (!returned.has(urn)) throw new Error('get_entities response omitted the requested entity')
      const expiresAtMs = capturedAtMs + resolveEvidenceTtlMs().get_entities
      const cacheKey = `get_entities:${JSON.stringify({ urns: [urn] })}`
      contextCache.set(cacheKey, { result, capturedAt: capturedAtMs, expiresAt: expiresAtMs })
      return [urn, {
        result,
        evidence: {
          name: 'get_entities' as const,
          capability: 'entity.read' as const,
          status: 'ok' as const,
          summary: 'Catalog entity summary received.',
          capturedAt: entityCapturedAt,
          expiresAt: new Date(expiresAtMs).toISOString(),
          cached: false,
          stale: false,
        },
      }] as const
    } catch (error) {
      return [urn, {
        result: undefined,
        evidence: {
          name: 'get_entities' as const,
          capability: 'entity.read' as const,
          status: 'error' as const,
          summary: `${error instanceof Error ? error.message : 'Unknown MCP error'} (${urn})`,
          capturedAt: entityCapturedAt,
          expiresAt: entityCapturedAt,
          cached: false,
          stale: true,
        },
      }] as const
    }
  })
  for (const [urn, read] of fetched) {
    reads.set(urn, read)
  }
  return reads
}

type PendingSummaryInspection = {
  urn: string
  force: boolean
  resolve(value: { asset: DataHubAssetSummary; evidence: DataHubMcpRead[] }): void
}
let pendingSummaryInspections: PendingSummaryInspection[] = []
let summaryFlushScheduled = false

async function flushSummaryInspections() {
  summaryFlushScheduled = false
  const pending = pendingSummaryInspections
  pendingSummaryInspections = []
  // Field profiles are aggregate-only but can be wide. Smaller GraphQL batches
  // keep the payload and latency bounded while the outer explorer remains parallel.
  for (let offset = 0; offset < pending.length; offset += 8) {
    const batch = pending.slice(offset, offset + 8)
    const urns = [...new Set(batch.map((item) => item.urn))]
    let reads: Awaited<ReturnType<typeof readEntityBatch>>
    try {
      reads = await readEntityBatch(urns, batch.some((item) => item.force))
    } catch (error) {
      const capturedAt = new Date().toISOString()
      reads = new Map(urns.map((urn) => [urn, {
        result: undefined,
        evidence: {
          name: 'get_entities' as const,
          capability: 'entity.read' as const,
          status: 'error' as const,
          summary: `${error instanceof Error ? error.message : 'Unknown MCP error'} (${urn})`,
          capturedAt,
          expiresAt: capturedAt,
          cached: false,
          stale: true,
        },
      }]))
    }
    for (const item of batch) {
      const read = reads.get(item.urn)
      const evidence = read?.evidence ?? {
        name: 'get_entities' as const,
        capability: 'entity.read' as const,
        status: 'error' as const,
        summary: `No batch result was produced (${item.urn})`,
        capturedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        cached: false,
        stale: true,
      }
      item.resolve({
        asset: parseAssetContext({
          urn: item.urn,
          entityPayload: readStructuredToolResult(read?.result),
          capturedAt: evidence.capturedAt,
          expiresAt: evidence.expiresAt,
        }),
        evidence: [evidence],
      })
    }
  }
}

function inspectDataHubAssetSummary(urn: string, force: boolean) {
  return new Promise<{ asset: DataHubAssetSummary; evidence: DataHubMcpRead[] }>((resolve) => {
    pendingSummaryInspections.push({ urn, force, resolve })
    if (summaryFlushScheduled) return
    summaryFlushScheduled = true
    setTimeout(() => { void flushSummaryInspections() }, 0)
  })
}

const deepDatasetQuery = `query DataLabDeepDataset($urn: String!) {
  entity(urn: $urn) {
    urn
    type
    ... on Dataset {
      name
      platform { urn name }
      properties { name description }
      editableProperties { description }
      ownership {
        owners {
          owner {
            ... on CorpUser { urn username properties { displayName } }
            ... on CorpGroup { urn name properties { displayName } }
          }
        }
      }
      tags { tags { tag { urn name properties { name } } } }
      glossaryTerms { terms { term { urn properties { name } } } }
      domain { domain { urn properties { name } } }
      schemaMetadata {
        fields {
          fieldPath
          nativeDataType
          tags { tags { tag { urn name properties { name } } } }
          glossaryTerms { terms { term { urn properties { name } } } }
        }
      }
      editableSchemaMetadata {
        editableSchemaFieldInfo {
          fieldPath
          tags { tags { tag { urn name properties { name } } } }
          glossaryTerms { terms { term { urn properties { name } } } }
        }
      }
      datasetProfiles(limit: 2) {
        timestampMillis
        rowCount
        columnCount
        fieldProfiles {
          fieldPath
          uniqueCount
          uniqueProportion
          nullCount
          nullProportion
          min
          max
          mean
          median
          stdev
        }
      }
      health { type status message }
      upstream: lineage(input: { direction: UPSTREAM, start: 0, count: 30 }) {
        relationships {
          entity {
            urn
            type
            ... on Dataset { name tags { tags { tag { urn name properties { name } } } } }
          }
        }
      }
      downstream: lineage(input: { direction: DOWNSTREAM, start: 0, count: 30 }) {
        relationships {
          entity {
            urn
            type
            ... on Dataset { name tags { tags { tag { urn name properties { name } } } } }
          }
        }
      }
    }
  }
}`

async function inspectDataHubAssetViaGms(urn: string, config: ReturnType<typeof configuration>) {
  const data = await postDataHubGraphql<{ entity?: Record<string, unknown> }>(
    config,
    deepDatasetQuery,
    { urn },
    'DataHub GMS GraphQL deep dataset response',
  )
  const entity = data.entity
  if (!entity || entity.urn !== urn) throw new Error('DataHub GMS GraphQL omitted the requested dataset')
  const capturedAtMs = Date.now()
  const capturedAt = new Date(capturedAtMs).toISOString()
  const ttls = resolveEvidenceTtlMs()
  const evidence = ([
    ['get_entities', 'Entity, ownership, tags and health received from DataHub GMS GraphQL.'],
    ['list_schema_fields', 'Schema fields received from DataHub GMS GraphQL.'],
    ['get_lineage', 'Upstream lineage received from DataHub GMS GraphQL.'],
    ['get_lineage', 'Downstream lineage received from DataHub GMS GraphQL.'],
  ] as const).map(([name, summary]) => ({
    name,
    capability: evidenceCapability[name],
    status: 'ok' as const,
    summary,
    capturedAt,
    expiresAt: new Date(capturedAtMs + ttls[name]).toISOString(),
    cached: false,
    stale: false,
  }))
  const asset = parseAssetContext({
    urn,
    entityPayload: { result: [entity] },
    schemaPayload: { fields: (entity.schemaMetadata as { fields?: unknown[] } | undefined)?.fields ?? [] },
    upstreamPayload: entity.upstream,
    downstreamPayload: entity.downstream,
    capturedAt,
    expiresAt: evidence.map((read) => read.expiresAt).sort()[0],
  })
  return { asset, evidence }
}

export function buildDataHubSearchQuery(query: string): string {
  const clean = query.trim().slice(0, 500)
  if (clean === '*') return '*'
  const terms = [...new Set(clean
    .replace(/^\/q\s+/i, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9_]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => term.length >= 2))]
    .slice(0, 16)
  if (!terms.length) throw new Error('Enter at least two searchable characters to search DataHub')
  return `/q ${terms.join('+')}`
}

export async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency)), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(values[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}

export async function mapWithRetryConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number, attempt: number) => Promise<R>,
  options: {
    attempts?: number
    beforeRetry?(failedValues: T[], attempt: number): Promise<void>
    label?: string
  } = {},
): Promise<Awaited<R>[]> {
  const attempts = Math.max(1, Math.min(3, Math.floor(options.attempts ?? 2)))
  const results = new Array<Awaited<R>>(values.length)
  let pending = values.map((value, index) => ({ value, index }))
  let lastErrors = new Map<number, unknown>()
  for (let attempt = 1; attempt <= attempts && pending.length; attempt += 1) {
    const outcomes = await mapWithConcurrency(pending, concurrency, async (item) => {
      try {
        return { ok: true, item, result: await worker(item.value, item.index, attempt) } as const
      } catch (error) {
        return { ok: false, item, error } as const
      }
    })
    const failed: typeof pending = []
    lastErrors = new Map()
    for (const outcome of outcomes) {
      if (outcome.ok) results[outcome.item.index] = outcome.result
      else {
        failed.push(outcome.item)
        lastErrors.set(outcome.item.index, outcome.error)
      }
    }
    pending = failed
    if (pending.length && attempt < attempts) await options.beforeRetry?.(pending.map((item) => item.value), attempt)
  }
  if (pending.length) {
    const details = pending.map((item) => {
      const error = lastErrors.get(item.index)
      return `${String(item.value)}: ${error instanceof Error ? error.message : String(error)}`
    }).join(' | ')
    throw new Error(`${options.label ?? 'operation'} failed after ${attempts} attempts (${details})`)
  }
  return results
}

export async function searchDataHubAssets(query: string): Promise<DataHubAssetSummary[]> {
  const structuredQuery = buildDataHubSearchQuery(query)
  const config = configuration(true)
  const route = config.settings.catalogReadRoute ?? 'auto'
  if (config.mode === 'stdio' && config.url && route !== 'mcp') {
    const pageSize = 250
    const searchPage = async (start: number) => postDataHubGraphql<{
      search?: { total?: number; searchResults?: unknown[] }
    }>(
      config,
      `query DataLabCatalogSearch($input: SearchInput!) {
        search(input: $input) {
          total
          searchResults {
            entity {
              urn
              type
              ... on Dataset { name properties { name } }
            }
          }
        }
      }`,
      { input: { type: 'DATASET', query: structuredQuery, start, count: pageSize } },
      `DataHub GMS GraphQL catalog search page ${Math.floor(start / pageSize) + 1}`,
    )
    const first = await searchPage(0)
    const firstPayload = first.search ?? {}
    const total = resolveCatalogSearchTotal(Number(firstPayload.total ?? 0))
    const offsets = Array.from({ length: Math.max(0, Math.ceil(total / pageSize) - 1) }, (_, index) => (index + 1) * pageSize)
    const remaining = await mapWithConcurrency(offsets, 3, searchPage)
    const seen = new Set<string>()
    return [firstPayload, ...remaining.map((page) => page.search ?? {})].flatMap((page) => parseSearchResults(page, pageSize)).flatMap((match) => {
      if (seen.has(match.urn)) return []
      seen.add(match.urn)
      return [parseAssetContext({ urn: match.urn, name: match.name })]
    }).slice(0, total)
  }
  const pageSize = 10
  const searchPage = async (offset: number, attempt: number) => {
    const client = await connectClient()
    const available = await discoverReadableToolNames(client)
    if (!available.has('search')) throw new Error('The connected DataHub MCP server does not expose search')
    const page = Math.floor(offset / pageSize) + 1
    const result = assertBoundedMcpPayload(await runBoundedMcpRead(() => callToolWithSdkTimeout(
      client,
      { name: 'search', arguments: { query: structuredQuery, filter: 'entity_type = dataset', num_results: pageSize, offset } },
      20_000,
      `search page ${page} attempt ${attempt}`,
    )), 'search response')
    if (result.isError) throw new Error(summarizeResult(result))
    const payload = readStructuredToolResult(result)
    return { matches: parseSearchResults(payload), total: parseSearchTotal(payload) }
  }
  const reconnectBeforeRetry = async () => { await closeDataHubMcp() }
  const [first] = await mapWithRetryConcurrency([0], 1, searchPage, {
    attempts: 2,
    beforeRetry: reconnectBeforeRetry,
    label: 'DataHub catalog first page',
  })
  if (!first.matches.length) return []
  const total = resolveCatalogSearchTotal(first.total)
  const offsets = Array.from({ length: Math.max(0, Math.ceil(total / pageSize) - 1) }, (_, index) => (index + 1) * pageSize)
  const pages = await mapWithRetryConcurrency(offsets, 3, searchPage, {
    attempts: 2,
    beforeRetry: reconnectBeforeRetry,
    label: 'DataHub catalog pages',
  })
  const seen = new Set<string>()
  return [first, ...pages].flatMap((page) => page.matches).flatMap((match) => {
    if (seen.has(match.urn)) return []
    seen.add(match.urn)
    return [parseAssetContext({ urn: match.urn, name: match.name })]
  }).slice(0, total)
}

export function resolveCatalogSearchTotal(total: number) {
  return Math.min(Math.max(0, Math.floor(total)), 2_000)
}

export async function inspectDataHubAsset(urn: string, force = false, mode: DataHubInspectionMode = 'deep'): Promise<{ asset: DataHubAssetSummary; evidence: DataHubMcpRead[] }> {
  validateDatasetUrn(urn)
  if (mode === 'summary') return inspectDataHubAssetSummary(urn, force)
  const config = configuration(true)
  const route = config.settings.catalogReadRoute ?? 'auto'
  if (config.mode === 'stdio' && config.url && route !== 'mcp') {
    return inspectDataHubAssetViaGms(urn, config)
  }
  const client = await connectClient()
  const available = await discoverReadableToolNames(client)
  const lineageSchema = toolCatalog?.tools.find((tool) => tool.name === 'get_lineage')?.inputSchema
  // Two bounded waves keep catalog exploration responsive without restoring
  // the former 4 × N burst that overwhelmed the stdio MCP server.
  const [entity, schema] = await Promise.all([
    readCachedTool({ client, available, urn, name: 'get_entities', arguments: { urns: [urn] }, force }),
    readCachedTool({ client, available, urn, name: 'list_schema_fields', arguments: { urn }, force }),
  ])
  const [upstream, downstream] = await Promise.all([
    readCachedTool({ client, available, urn, name: 'get_lineage', arguments: resolveLineageArguments(lineageSchema, urn, true), force }),
    readCachedTool({ client, available, urn, name: 'get_lineage', arguments: resolveLineageArguments(lineageSchema, urn, false), force }),
  ])
  const evidence = [entity.evidence, schema.evidence, upstream.evidence, downstream.evidence]
  const successful = evidence.filter((item) => item.status === 'ok').sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))[0]
  const asset = parseAssetContext({
    urn,
    entityPayload: readStructuredToolResult(entity.result),
    schemaPayload: readStructuredToolResult(schema.result),
    upstreamPayload: readStructuredToolResult(upstream.result),
    downstreamPayload: readStructuredToolResult(downstream.result),
    capturedAt: successful?.capturedAt,
    expiresAt: successful?.expiresAt,
  })
  return { asset, evidence }
}

export function invalidateDataHubContext(urn?: string) {
  for (const key of contextCache.keys()) if (!urn || key.includes(urn)) contextCache.delete(key)
  return { invalidated: true }
}

export interface DataHubDecisionRequest { revisionId: string; title: string; rationale: string; author: string; relatedAssets: string[] }

export function parseDataHubDecisionRequest(payload: unknown): DataHubDecisionRequest {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid DataHub write-back request')
  const value = payload as Record<string, unknown>
  const revisionId = typeof value.revisionId === 'string' ? value.revisionId.trim().slice(0, 180) : ''
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 180) : ''
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim().slice(0, 4_000) : ''
  const author = typeof value.author === 'string' ? value.author.trim().slice(0, 180) : 'SAM LAB operator'
  const relatedAssets = Array.isArray(value.relatedAssets) ? value.relatedAssets.filter((item): item is string => typeof item === 'string' && item.startsWith('urn:li:')).slice(0, 20) : []
  if (!revisionId || !title || !rationale) throw new Error('Revision ID, title and rationale are required for DataHub write-back')
  return { revisionId, title, rationale, author, relatedAssets }
}

export async function writeDataHubDecision(payload: unknown): Promise<{ written: true; tool: 'createDocument' | 'save_document'; summary: string }> {
  const config = configuration(true)
  if (!config.settings.writebackEnabled) throw new Error('DataHub write-back is disabled in Settings')
  const { revisionId, title, rationale, author, relatedAssets } = parseDataHubDecisionRequest(payload)
  const content = `## SAM LAB approved decision\n\n**Revision:** ${revisionId}\n\n**Author:** ${author}\n\n## Rationale\n\n${rationale}`
  if (config.mode === 'stdio' && config.url) {
    const data = await postDataHubGraphql<{ createDocument?: string }>(
      config,
      'mutation DataLabCreateDecision($input: CreateDocumentInput!) { createDocument(input: $input) }',
      {
        input: {
          subType: 'Decision',
          title: `SAM LAB · ${title}`,
          contents: { text: content },
          relatedAssets,
        },
      },
      'DataHub GMS GraphQL createDocument response',
    )
    if (!data.createDocument?.startsWith('urn:li:')) throw new Error('DataHub GMS GraphQL did not return the created Decision URN')
    return { written: true, tool: 'createDocument', summary: `Decision published as ${data.createDocument}` }
  }
  const client = await connectClient()
  const listed = await discoverTools(client, 'DataHub MCP mutation discovery')
  if (!hasExplicitDataHubWritebackTool(listed)) throw new Error('The explicitly enabled save_document mutation tool is unavailable')
  const result = assertBoundedMcpPayload(await callToolWithSdkTimeout(client, { name: 'save_document', arguments: { document_type: 'Decision', title: `SAM LAB · ${title}`, content, topics: ['sam-lab', 'approved-revision'], related_assets: relatedAssets } }, 20_000, 'save_document'), 'save_document response')
  if (result.isError) throw new Error(summarizeResult(result))
  return { written: true, tool: 'save_document', summary: summarizeResult(result) }
}

export async function auditDataHubWithMcp(urn: string, force = false): Promise<DataHubMcpAudit> {
  validateDatasetUrn(urn)
  const config = configuration(true)
  const route = config.settings.catalogReadRoute ?? 'auto'
  if (config.mode === 'stdio' && config.url && route !== 'mcp') {
    const inspection = await inspectDataHubAssetViaGms(urn, config)
    return {
      urn,
      transport: 'stdio',
      route: 'gms-graphql',
      reads: inspection.evidence,
      asset: inspection.asset,
    }
  }
  const inspection = await inspectDataHubAsset(urn, force, 'deep')
  const client = activeClient

  return {
    urn,
    transport: activeMode ?? 'stdio',
    route: 'mcp',
    serverVersion: client?.getServerVersion()?.version,
    reads: inspection.evidence,
    asset: inspection.asset,
  }
}

export async function closeDataHubMcp() {
  const client = activeClient
  const transport = activeTransport
  activeClient = undefined
  activeTransport = undefined
  activeMode = undefined
  connectionPromise = undefined
  toolCatalog = undefined
  toolDiscoveryPromise = undefined
  contextCache.clear()
  if (client) await client.close().catch(() => undefined)
  else if (transport) await transport.close().catch(() => undefined)
}
