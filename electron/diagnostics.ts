import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_STRING_LENGTH = 500
const categories = new Set(['mcp', 'provider', 'validation', 'revision', 'renderer', 'workspace'])
const statuses = new Set(['info', 'success', 'warning', 'error'])
const secretKeyPattern = /authorization|api[-_]?key|password|secret|token|credential|cookie/i
const diagnosticLevels = new Set(['all', 'warnings', 'errors'])

export interface DiagnosticSettings {
  enabled: boolean
  level: 'all' | 'warnings' | 'errors'
  maximumEvents: number
  retentionDays: number
}

export const defaultDiagnosticSettings: DiagnosticSettings = {
  enabled: true,
  level: 'all',
  maximumEvents: 500,
  retentionDays: 7,
}

export interface DiagnosticEvent {
  action: string
  category: 'mcp' | 'provider' | 'validation' | 'revision' | 'renderer' | 'workspace'
  detail?: unknown
  id: string
  status: 'info' | 'success' | 'warning' | 'error'
  timestamp: string
}

export interface DiagnosticBundle {
  events: DiagnosticEvent[]
  generatedAt: string
  settings: DiagnosticSettings
  schemaVersion: 1
  telemetryEnabled: false
}

export function diagnosticLogPath(userDataDirectory: string) {
  return join(userDataDirectory, 'sam-lab-diagnostics.json')
}

export function diagnosticSettingsPath(userDataDirectory: string) {
  return join(userDataDirectory, 'sam-lab-diagnostics-settings.json')
}

function parseDiagnosticSettings(input: unknown): DiagnosticSettings {
  if (!input || typeof input !== 'object') return { ...defaultDiagnosticSettings }
  const candidate = input as Partial<DiagnosticSettings>
  return {
    enabled: candidate.enabled !== false,
    level: typeof candidate.level === 'string' && diagnosticLevels.has(candidate.level) ? candidate.level as DiagnosticSettings['level'] : defaultDiagnosticSettings.level,
    maximumEvents: typeof candidate.maximumEvents === 'number' && Number.isInteger(candidate.maximumEvents) ? Math.min(2_000, Math.max(100, candidate.maximumEvents)) : defaultDiagnosticSettings.maximumEvents,
    retentionDays: typeof candidate.retentionDays === 'number' && Number.isInteger(candidate.retentionDays) ? Math.min(30, Math.max(1, candidate.retentionDays)) : defaultDiagnosticSettings.retentionDays,
  }
}

export function loadDiagnosticSettings(userDataDirectory: string): DiagnosticSettings {
  const path = diagnosticSettingsPath(userDataDirectory)
  if (!existsSync(path)) return { ...defaultDiagnosticSettings }
  try { return parseDiagnosticSettings(JSON.parse(readFileSync(path, 'utf8'))) }
  catch { return { ...defaultDiagnosticSettings } }
}

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|gho|ghp|glpat|dht)[-_][A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/([?&](?:token|api_key|key|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, MAX_STRING_LENGTH)
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0, parentSensitive = false): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (typeof value === 'string') return parentSensitive ? '[REDACTED]' : redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, depth + 1, parentSensitive))
  if (!value || typeof value !== 'object') return String(value).slice(0, MAX_STRING_LENGTH)
  const source = value as Record<string, unknown>
  const sensitive = parentSensitive || source.sensitive === true
  return Object.fromEntries(Object.entries(source).slice(0, 50).map(([key, entry]) => {
    const redact = secretKeyPattern.test(key) || (sensitive && /prompt|content|value|text/i.test(key))
    return [key.slice(0, 80), redact ? '[REDACTED]' : sanitizeDiagnosticValue(entry, depth + 1, sensitive)]
  }))
}

function readEvents(userDataDirectory: string) {
  const path = diagnosticLogPath(userDataDirectory)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((event): event is DiagnosticEvent => Boolean(event && typeof event === 'object' && typeof event.timestamp === 'string')) : []
  } catch { return [] }
}

function retained(events: DiagnosticEvent[], settings: DiagnosticSettings, now = Date.now()) {
  const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1_000
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp)
    return Number.isFinite(timestamp) && now - timestamp <= retentionMs
  }).slice(-settings.maximumEvents)
}

function writeEvents(userDataDirectory: string, events: DiagnosticEvent[]) {
  const path = diagnosticLogPath(userDataDirectory)
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(events), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
}

export function recordDiagnosticEvent(userDataDirectory: string, input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Invalid diagnostic event')
  const candidate = input as Record<string, unknown>
  if (typeof candidate.category !== 'string' || !categories.has(candidate.category)) throw new Error('Invalid diagnostic category')
  if (typeof candidate.status !== 'string' || !statuses.has(candidate.status)) throw new Error('Invalid diagnostic status')
  if (typeof candidate.action !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(candidate.action)) throw new Error('Invalid diagnostic action')
  const event: DiagnosticEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    category: candidate.category as DiagnosticEvent['category'],
    status: candidate.status as DiagnosticEvent['status'],
    action: candidate.action,
    detail: sanitizeDiagnosticValue(candidate.detail),
  }
  const settings = loadDiagnosticSettings(userDataDirectory)
  if (!settings.enabled) return undefined
  if (settings.level === 'errors' && event.status !== 'error') return undefined
  if (settings.level === 'warnings' && event.status !== 'warning' && event.status !== 'error') return undefined
  const events = retained([...readEvents(userDataDirectory), event], settings)
  writeEvents(userDataDirectory, events)
  return event
}

export function exportDiagnosticBundle(userDataDirectory: string): DiagnosticBundle {
  const settings = loadDiagnosticSettings(userDataDirectory)
  const events = settings.enabled ? retained(readEvents(userDataDirectory), settings).map((event) => ({ ...event, detail: sanitizeDiagnosticValue(event.detail) })) : []
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), telemetryEnabled: false, settings, events }
}

export function saveDiagnosticSettings(userDataDirectory: string, input: unknown): DiagnosticSettings {
  const settings = parseDiagnosticSettings(input)
  const path = diagnosticSettingsPath(userDataDirectory)
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
  writeEvents(userDataDirectory, settings.enabled ? retained(readEvents(userDataDirectory), settings) : [])
  return settings
}

export function ensureDiagnosticLog(userDataDirectory: string) {
  const path = diagnosticLogPath(userDataDirectory)
  if (!existsSync(path)) writeEvents(userDataDirectory, [])
  return path
}
