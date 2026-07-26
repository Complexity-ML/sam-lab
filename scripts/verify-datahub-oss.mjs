#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'

const requiredTools = ['get_entities', 'list_schema_fields', 'get_lineage']
const maxResponseBytes = 2_000_000
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=')
  return [key.replace(/^--/, ''), value.join('=')]
}))
const gmsUrl = args.get('gms-url') || process.env.DATAHUB_GMS_URL || 'http://localhost:8080'
const query = args.get('query') || 'customer'
const requestedUrn = args.get('urn') || ''

function timeout(operation, timeoutMs, label) {
  let timer
  return Promise.race([
    operation,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1_000}s`)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

function bounded(value, label) {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > maxResponseBytes) throw new Error(`${label} exceeded ${maxResponseBytes} bytes`)
  return value
}

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function array(value) { return Array.isArray(value) ? value : [] }
function sanitize(value, limit = 320) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function structured(result) {
  const value = record(result)
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent
  for (const item of array(value.content)) {
    const block = record(item)
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try { return JSON.parse(block.text) } catch { /* inspect the next text block */ }
  }
  return {}
}

function collectDatasetUrns(value, found = new Set(), depth = 0) {
  if (depth > 12 || found.size >= 30 || value == null) return found
  if (typeof value === 'string') {
    if (value.startsWith('urn:li:dataset:') && value.length <= 2_000) found.add(value)
    return found
  }
  if (Array.isArray(value)) for (const item of value) collectDatasetUrns(item, found, depth + 1)
  else if (typeof value === 'object') for (const item of Object.values(value)) collectDatasetUrns(item, found, depth + 1)
  return found
}

function extractFields(value, found = [], depth = 0) {
  if (depth > 10 || found.length >= 100 || value == null) return found
  if (Array.isArray(value)) for (const item of value) extractFields(item, found, depth + 1)
  else if (typeof value === 'object') {
    const item = record(value)
    const name = item.fieldPath ?? item.field_path ?? item.name
    const type = item.nativeDataType ?? item.native_data_type ?? item.type
    if (typeof name === 'string' && (typeof type === 'string' || 'fieldPath' in item || 'field_path' in item)) {
      const tags = [...new Set(JSON.stringify(item).match(/\b(?:PII|PERSONAL|SENSITIVE|GDPR)\b/gi) ?? [])]
      found.push({ name: sanitize(name, 240), type: sanitize(type || 'unknown', 120), tags })
    }
    for (const child of Object.values(item)) extractFields(child, found, depth + 1)
  }
  return found
}

function summarize(result) {
  const value = record(result)
  const source = value.structuredContent ?? array(value.content).map((item) => record(item).text).filter(Boolean).join(' ') ?? ''
  return sanitize(typeof source === 'string' ? source : JSON.stringify(source), 320)
}

const transport = new StdioClientTransport({
  command: process.env.DATAHUB_MCP_COMMAND?.trim() || 'uvx',
  args: [process.env.DATAHUB_MCP_PACKAGE?.trim() || 'mcp-server-datahub@latest'],
  env: { ...getDefaultEnvironment(), DATAHUB_GMS_URL: gmsUrl, TOOLS_IS_MUTATION_ENABLED: 'false' },
  stderr: 'pipe',
})
const client = new Client({ name: 'sam-lab-oss-verifier', version: '0.1.0' })

try {
  await timeout(client.connect(transport), 30_000, 'MCP connection')
  const catalog = bounded(await timeout(client.listTools(), 20_000, 'MCP tool discovery'), 'MCP tool catalog')
  const available = new Set(catalog.tools.map((tool) => tool.name).filter((name) => typeof name === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(name)))
  for (const tool of ['search', ...requiredTools]) if (!available.has(tool)) throw new Error(`Required MCP tool is unavailable: ${tool}`)
  if (args.has('catalog')) {
    process.stdout.write(`${JSON.stringify(catalog.tools.filter((tool) => ['search', ...requiredTools].includes(tool.name)).map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })), null, 2)}\n`)
    process.exitCode = 0
  } else {

    let urn = requestedUrn
    let searchResult
    if (!urn) {
      searchResult = bounded(await timeout(client.callTool({ name: 'search', arguments: { query: `/q ${query.replace(/\s+/g, '+')}`, filter: 'entity_type = dataset', num_results: 20, offset: 0 } }), 20_000, 'search'), 'search response')
      urn = [...collectDatasetUrns(structured(searchResult))][0] || ''
    }
    if (!urn.startsWith('urn:li:dataset:')) throw new Error(`No DataHub dataset matched query: ${query}`)

    const lineageProperties = record(record(catalog.tools.find((tool) => tool.name === 'get_lineage')?.inputSchema).properties)
    const lineageArgs = { urn, max_hops: 3 }
    if ('direction' in lineageProperties) lineageArgs.direction = 'downstream'
    if ('upstream' in lineageProperties) lineageArgs.upstream = false
    if ('count' in lineageProperties) lineageArgs.count = 30
    if ('max_results' in lineageProperties) lineageArgs.max_results = 30
    const calls = [
      ['get_entities', { urns: [urn] }],
      ['list_schema_fields', { urn }],
      ['get_lineage', lineageArgs],
    ]
    const results = []
    for (const [name, toolArgs] of calls) {
    const startedAt = new Date().toISOString()
    const result = bounded(await timeout(client.callTool({ name, arguments: toolArgs }), 20_000, name), `${name} response`)
    if (result.isError) throw new Error(`${name} failed: ${summarize(result)}`)
    const payload = structured(result)
      results.push({
      tool: name,
      status: 'ok',
      capturedAt: startedAt,
      summary: summarize(result),
      ...(name === 'list_schema_fields' ? { fields: extractFields(payload).slice(0, 40) } : {}),
      ...(name === 'get_lineage' ? { downstreamUrns: [...collectDatasetUrns(payload)].filter((candidate) => candidate !== urn).slice(0, 30) } : {}),
      })
    }

    const fields = results.find((result) => result.tool === 'list_schema_fields')?.fields ?? []
    const piiFields = fields.filter((field) => field.tags.some((tag) => /pii|personal|sensitive|gdpr/i.test(tag)))
    const downstreamUrns = results.find((result) => result.tool === 'get_lineage')?.downstreamUrns ?? []
    process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { transport: 'stdio', server: 'mcp-server-datahub', gmsUrl, query, urn },
    safety: { mutationToolsEnabled: false, rawRowsCaptured: false, credentialsCaptured: false, maxResponseBytes },
    requiredTools: Object.fromEntries(requiredTools.map((name) => [name, 'ok'])),
    findings: { fieldCount: fields.length, piiFields, downstreamCount: downstreamUrns.length, downstreamUrns },
    evidence: results,
    }, null, 2)}\n`)
  }
} finally {
  await timeout(client.close(), 2_000, 'MCP close').catch(() => transport.close())
}
