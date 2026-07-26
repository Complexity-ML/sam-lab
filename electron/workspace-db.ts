import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const ACTIVE_WORKSPACE_KEY = 'active-workspace-id'
const CLEAN_SHUTDOWN_KEY = 'workspace-session-clean'
const MAX_PAYLOAD_BYTES = 8_000_000

let database: DatabaseSync | undefined

export interface WorkspaceSummary {
  id: string
  name: string
  archived: boolean
  dirty: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkspaceRecord extends WorkspaceSummary {
  payload: unknown
}

export interface WorkspaceRecovery {
  payload: unknown
  updatedAt: string
}

export interface WorkspaceManagerState {
  activeWorkspace?: WorkspaceRecord
  activeWorkspaceId: string | null
  recovery?: WorkspaceRecovery
  uncleanShutdown: boolean
  workspaces: WorkspaceSummary[]
}

type WorkspaceRow = {
  archived: number
  created_at: string
  dirty: number
  draft_payload: string | null
  draft_updated_at: string | null
  id: string
  name: string
  payload: string
  updated_at: string
}

export interface IncidentEventInput {
  incidentKey: string
  transition: 'opened' | 'worsened' | 'agent-action' | 'human-review' | 'recovered'
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  sourceSystem?: string
  sourceRef?: string
  fingerprint?: string
  cardId?: string
  branchId?: string
  versionId?: string
}

export interface IncidentEvent extends IncidentEventInput {
  id: string
  workspaceId?: string
  createdAt: string
}

type IncidentRow = {
  id: string
  workspace_id: string | null
  incident_key: string
  transition: IncidentEventInput['transition']
  severity: IncidentEventInput['severity']
  title: string
  detail: string
  source_system: string | null
  source_ref: string | null
  fingerprint: string | null
  card_id: string | null
  branch_id: string | null
  version_id: string | null
  created_at: string
}

function parsePayload(serialized: unknown): unknown | null {
  if (typeof serialized !== 'string') return null
  try { return JSON.parse(serialized) } catch { return null }
}

function serializePayload(payload: unknown) {
  const serialized = JSON.stringify(payload)
  if (typeof serialized !== 'string') throw new Error('Workspace payload must be JSON serializable')
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Workspace exceeds the 8 MB SQLite safety limit')
  return serialized
}

function normalizeWorkspaceName(name: unknown) {
  if (typeof name !== 'string') throw new Error('Workspace name is required')
  const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!normalized) throw new Error('Workspace name is required')
  return normalized
}

function writeSetting(target: DatabaseSync, key: string, value: string) {
  target.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString())
}

function readSetting(target: DatabaseSync, key: string) {
  const row = target.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value?: unknown } | undefined
  return typeof row?.value === 'string' ? row.value : null
}

function migrateLegacyWorkspace(target: DatabaseSync) {
  const count = target.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number }
  if (Number(count.count) > 0) return
  const legacy = target.prepare('SELECT payload, updated_at FROM workspace_state WHERE id = 1').get() as { payload?: unknown; updated_at?: unknown } | undefined
  const payload = parsePayload(legacy?.payload)
  if (payload === null || typeof legacy?.payload !== 'string') return
  const suggestedName = payload && typeof payload === 'object' && 'projectTitle' in payload ? (payload as { projectTitle?: unknown }).projectTitle : undefined
  const name = typeof suggestedName === 'string' && suggestedName.trim() ? normalizeWorkspaceName(suggestedName) : 'Migrated workspace'
  const timestamp = typeof legacy.updated_at === 'string' ? legacy.updated_at : new Date().toISOString()
  const id = `workspace-${randomUUID()}`
  target.prepare(`
    INSERT INTO workspaces (id, name, payload, archived, dirty, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, ?, ?)
  `).run(id, name, legacy.payload, timestamp, timestamp)
  writeSetting(target, ACTIVE_WORKSPACE_KEY, id)
}

function db(userDataDirectory: string) {
  if (database) return database
  database = new DatabaseSync(join(userDataDirectory, 'sam-lab.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS workspace_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      draft_payload TEXT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      draft_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS workspaces_archived_updated_idx ON workspaces (archived, updated_at DESC);
    CREATE TABLE IF NOT EXISTS incident_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      incident_key TEXT NOT NULL,
      transition TEXT NOT NULL CHECK (transition IN ('opened', 'worsened', 'agent-action', 'human-review', 'recovered')),
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      source_system TEXT,
      source_ref TEXT,
      fingerprint TEXT,
      card_id TEXT,
      branch_id TEXT,
      version_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS incident_events_workspace_time_idx ON incident_events (workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS incident_events_key_time_idx ON incident_events (incident_key, created_at DESC);
    CREATE TABLE IF NOT EXISTS catalog_checkpoints (
      scope_id TEXT NOT NULL,
      checkpoint_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, checkpoint_key)
    );
  `)
  const incidentColumns = database.prepare('PRAGMA table_info(incident_events)').all() as unknown as { name: string }[]
  if (!incidentColumns.some((column) => column.name === 'fingerprint')) database.exec('ALTER TABLE incident_events ADD COLUMN fingerprint TEXT')
  if (!incidentColumns.some((column) => column.name === 'source_system')) database.exec('ALTER TABLE incident_events ADD COLUMN source_system TEXT')
  if (!incidentColumns.some((column) => column.name === 'source_ref')) database.exec('ALTER TABLE incident_events ADD COLUMN source_ref TEXT')
  migrateLegacyWorkspace(database)
  // Older releases persisted unsaved-workbench incidents with a NULL owner.
  // They cannot be restored safely into any later workspace, so remove them.
  database.prepare('DELETE FROM incident_events WHERE workspace_id IS NULL').run()
  return database
}

function rowToSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived === 1,
    dirty: row.dirty === 1,
    createdAt: row.created_at,
    updatedAt: row.draft_updated_at ?? row.updated_at,
  }
}

function readWorkspaceRow(target: DatabaseSync, workspaceId: string) {
  return target.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
}

function activeWorkspaceId(target: DatabaseSync) {
  const configured = readSetting(target, ACTIVE_WORKSPACE_KEY)
  if (configured && readWorkspaceRow(target, configured)?.archived === 0) return configured
  const fallback = target.prepare('SELECT id FROM workspaces WHERE archived = 0 ORDER BY updated_at DESC LIMIT 1').get() as { id?: unknown } | undefined
  const id = typeof fallback?.id === 'string' ? fallback.id : null
  if (id) writeSetting(target, ACTIVE_WORKSPACE_KEY, id)
  return id
}

function clearActiveWorkspace(target: DatabaseSync) {
  target.prepare('DELETE FROM app_settings WHERE key = ?').run(ACTIVE_WORKSPACE_KEY)
}

function promoteWorkspaceDraft(target: DatabaseSync, workspaceId: string) {
  target.prepare(`
    UPDATE workspaces
    SET payload = COALESCE(draft_payload, payload), draft_payload = NULL, dirty = 0,
        updated_at = COALESCE(draft_updated_at, updated_at), draft_updated_at = NULL
    WHERE id = ? AND dirty = 1
  `).run(workspaceId)
}

function promoteActiveWorkspaceDraft(target: DatabaseSync) {
  const workspaceId = activeWorkspaceId(target)
  if (workspaceId) promoteWorkspaceDraft(target, workspaceId)
}

function currentState(target: DatabaseSync, uncleanShutdown: boolean): WorkspaceManagerState {
  const workspaceId = activeWorkspaceId(target)
  const row = workspaceId ? readWorkspaceRow(target, workspaceId) : undefined
  const payload = parsePayload(row?.payload)
  const activeWorkspace = row && payload !== null ? { ...rowToSummary(row), payload } : undefined
  const draft = row?.dirty === 1 ? parsePayload(row.draft_payload) : null
  const recovery = uncleanShutdown && draft !== null && typeof row?.draft_updated_at === 'string'
    ? { payload: draft, updatedAt: row.draft_updated_at }
    : undefined
  const rows = target.prepare('SELECT * FROM workspaces ORDER BY archived ASC, updated_at DESC').all() as unknown as WorkspaceRow[]
  return { activeWorkspace, activeWorkspaceId: activeWorkspace?.id ?? null, recovery, uncleanShutdown, workspaces: rows.map(rowToSummary) }
}

export function beginWorkspaceSession(userDataDirectory: string) {
  const target = db(userDataDirectory)
  const previous = readSetting(target, CLEAN_SHUTDOWN_KEY)
  const uncleanShutdown = previous === 'false'
  writeSetting(target, CLEAN_SHUTDOWN_KEY, 'false')
  return uncleanShutdown
}

export function markWorkspaceSessionClean(userDataDirectory: string) {
  const target = db(userDataDirectory)
  target.exec(`
    UPDATE workspaces
    SET payload = COALESCE(draft_payload, payload), draft_payload = NULL, dirty = 0,
        updated_at = COALESCE(draft_updated_at, updated_at), draft_updated_at = NULL
    WHERE dirty = 1;
  `)
  writeSetting(target, CLEAN_SHUTDOWN_KEY, 'true')
}

export function loadWorkspaceManagerState(userDataDirectory: string, uncleanShutdown = false) {
  return currentState(db(userDataDirectory), uncleanShutdown)
}

export function listWorkspaces(userDataDirectory: string) {
  return currentState(db(userDataDirectory), false).workspaces
}

export function createWorkspace(userDataDirectory: string, name: unknown, payload: unknown) {
  const serialized = serializePayload(payload)
  const normalizedName = normalizeWorkspaceName(name)
  const target = db(userDataDirectory)
  promoteActiveWorkspaceDraft(target)
  const id = `workspace-${randomUUID()}`
  const timestamp = new Date().toISOString()
  target.prepare(`
    INSERT INTO workspaces (id, name, payload, archived, dirty, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, ?, ?)
  `).run(id, normalizedName, serialized, timestamp, timestamp)
  writeSetting(target, ACTIVE_WORKSPACE_KEY, id)
  return currentState(target, false)
}

export function renameWorkspace(userDataDirectory: string, workspaceId: unknown, name: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const result = db(userDataDirectory).prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?').run(normalizeWorkspaceName(name), new Date().toISOString(), workspaceId)
  if (Number(result.changes) !== 1) throw new Error('Workspace not found')
  return listWorkspaces(userDataDirectory)
}

export function duplicateWorkspace(userDataDirectory: string, workspaceId: unknown, name?: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  const source = readWorkspaceRow(target, workspaceId)
  if (!source) throw new Error('Workspace not found')
  const payload = parsePayload(source.draft_payload) ?? parsePayload(source.payload)
  const existingNames = new Set((target.prepare('SELECT name FROM workspaces').all() as unknown as { name: string }[]).map((workspace) => workspace.name.toLocaleLowerCase()))
  const baseName = source.name.replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || 'Workspace'
  let copyName = `${baseName} copy`
  let copyIndex = 2
  while (existingNames.has(copyName.toLocaleLowerCase())) copyName = `${baseName} copy ${copyIndex++}`
  return createWorkspace(userDataDirectory, name ?? copyName, payload)
}

export function archiveWorkspace(userDataDirectory: string, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) promoteWorkspaceDraft(target, workspaceId)
  const result = target.prepare('UPDATE workspaces SET archived = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), workspaceId)
  if (Number(result.changes) !== 1) throw new Error('Workspace not found')
  if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) clearActiveWorkspace(target)
  return currentState(target, false)
}

export function deleteWorkspace(userDataDirectory: string, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) throw new Error('The active workspace cannot be deleted')
  const workspace = readWorkspaceRow(target, workspaceId)
  if (!workspace || workspace.archived !== 1) throw new Error('Only an archived workspace can be deleted')
  target.exec('BEGIN')
  try {
    target.prepare('DELETE FROM incident_events WHERE workspace_id = ?').run(workspaceId)
    target.prepare('DELETE FROM catalog_checkpoints WHERE scope_id = ?').run(workspaceId)
    target.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
    target.exec('COMMIT')
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
  return currentState(target, false)
}

export function openWorkspace(userDataDirectory: string, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  const workspace = readWorkspaceRow(target, workspaceId)
  if (!workspace || workspace.archived === 1) throw new Error('Workspace not found or archived')
  promoteActiveWorkspaceDraft(target)
  writeSetting(target, ACTIVE_WORKSPACE_KEY, workspaceId)
  return currentState(target, false)
}

export function autosaveWorkspaceDraft(userDataDirectory: string, payload: unknown) {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) return { saved: false as const, reason: 'no-active-workspace' as const }
  const serialized = serializePayload(payload)
  const timestamp = new Date().toISOString()
  target.prepare('UPDATE workspaces SET draft_payload = ?, dirty = 1, draft_updated_at = ? WHERE id = ?').run(serialized, timestamp, workspaceId)
  return { saved: true as const, workspaceId, updatedAt: timestamp }
}

function catalogCheckpointScope(target: DatabaseSync) {
  return activeWorkspaceId(target) ?? 'workbench'
}

function normalizeCatalogCheckpointKey(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:._|*=-]{1,500}$/.test(value)) throw new Error('Invalid catalog checkpoint key')
  return value
}

export function loadCatalogCheckpoint(userDataDirectory: string, checkpointKey: unknown) {
  const target = db(userDataDirectory)
  const key = normalizeCatalogCheckpointKey(checkpointKey)
  const row = target.prepare('SELECT payload FROM catalog_checkpoints WHERE scope_id = ? AND checkpoint_key = ?')
    .get(catalogCheckpointScope(target), key) as { payload?: unknown } | undefined
  return parsePayload(row?.payload)
}

export function saveCatalogCheckpoint(userDataDirectory: string, checkpointKey: unknown, payload: unknown) {
  const target = db(userDataDirectory)
  const key = normalizeCatalogCheckpointKey(checkpointKey)
  const scopeId = catalogCheckpointScope(target)
  const serialized = serializePayload(payload)
  const updatedAt = new Date().toISOString()
  target.prepare(`
    INSERT INTO catalog_checkpoints (scope_id, checkpoint_key, payload, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_id, checkpoint_key) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(scopeId, key, serialized, updatedAt)
  return { saved: true as const, scopeId, updatedAt }
}

export function commitActiveWorkspace(userDataDirectory: string, payload: unknown) {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) throw new Error('Create a workspace before saving')
  const serialized = serializePayload(payload)
  const timestamp = new Date().toISOString()
  target.prepare(`
    UPDATE workspaces SET payload = ?, draft_payload = NULL, dirty = 0, updated_at = ?, draft_updated_at = NULL WHERE id = ?
  `).run(serialized, timestamp, workspaceId)
  return { saved: true as const, workspaceId, updatedAt: timestamp }
}

export function resolveWorkspaceRecovery(userDataDirectory: string, action: unknown) {
  if (action !== 'recover' && action !== 'discard') throw new Error('Invalid recovery action')
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) return currentState(target, false)
  if (action === 'recover') {
    target.prepare(`
      UPDATE workspaces
      SET payload = COALESCE(draft_payload, payload), draft_payload = NULL, dirty = 0,
          updated_at = COALESCE(draft_updated_at, updated_at), draft_updated_at = NULL
      WHERE id = ?
    `).run(workspaceId)
  } else {
    target.prepare('UPDATE workspaces SET draft_payload = NULL, dirty = 0, draft_updated_at = NULL WHERE id = ?').run(workspaceId)
  }
  return currentState(target, false)
}

// Backward-compatible helpers for older renderer builds and the one-time migration path.
export function loadSavedWorkspace(userDataDirectory: string): unknown | null {
  return loadWorkspaceManagerState(userDataDirectory).activeWorkspace?.payload ?? null
}

export function saveWorkspace(userDataDirectory: string, payload: unknown) {
  const state = loadWorkspaceManagerState(userDataDirectory)
  if (!state.activeWorkspaceId) {
    const suggestedName = payload && typeof payload === 'object' && 'projectTitle' in payload ? (payload as { projectTitle?: unknown }).projectTitle : undefined
    createWorkspace(userDataDirectory, typeof suggestedName === 'string' ? suggestedName : 'Workspace', payload)
  }
  const result = commitActiveWorkspace(userDataDirectory, payload)
  return { saved: result.saved }
}

export function loadAppSetting(userDataDirectory: string, key: string): string | null {
  if (!/^[a-z0-9-]{1,80}$/.test(key)) throw new Error('Invalid application setting key')
  return readSetting(db(userDataDirectory), key)
}

export function saveAppSetting(userDataDirectory: string, key: string, value: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(key) || value.length > 4_000) throw new Error('Invalid application setting')
  writeSetting(db(userDataDirectory), key, value)
}

function boundedIncidentText(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string') throw new Error(`${label} is required`)
  const clean = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .trim()
    .slice(0, maximum)
  if (!clean) throw new Error(`${label} is required`)
  return clean
}

function optionalIncidentText(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, maximum) || undefined
}

function incidentFromRow(row: IncidentRow): IncidentEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    incidentKey: row.incident_key,
    transition: row.transition,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    sourceSystem: row.source_system ?? undefined,
    sourceRef: row.source_ref ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
    cardId: row.card_id ?? undefined,
    branchId: row.branch_id ?? undefined,
    versionId: row.version_id ?? undefined,
    createdAt: row.created_at,
  }
}

export function listIncidentEvents(userDataDirectory: string, limit = 200): IncidentEvent[] {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) return []
  const boundedLimit = Math.max(1, Math.min(500, Math.round(limit)))
  const rows = target.prepare('SELECT * FROM incident_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(workspaceId, boundedLimit)
  return (rows as unknown as IncidentRow[]).map(incidentFromRow)
}

export function clearIncidentEvents(userDataDirectory: string): { deleted: number; workspaceId?: string } {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target) ?? undefined
  const result = workspaceId
    ? target.prepare('DELETE FROM incident_events WHERE workspace_id = ?').run(workspaceId)
    : target.prepare('DELETE FROM incident_events WHERE workspace_id IS NULL').run()
  return { deleted: Number(result.changes), workspaceId }
}

export function recordIncidentEvent(userDataDirectory: string, payload: unknown): { recorded: boolean; event?: IncidentEvent } {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid incident event')
  const value = payload as Record<string, unknown>
  const transitions = new Set(['opened', 'worsened', 'agent-action', 'human-review', 'recovered'])
  const severities = new Set(['info', 'warning', 'critical'])
  if (typeof value.transition !== 'string' || !transitions.has(value.transition)) throw new Error('Invalid incident transition')
  if (typeof value.severity !== 'string' || !severities.has(value.severity)) throw new Error('Invalid incident severity')
  const incidentKey = boundedIncidentText(value.incidentKey, 'Incident key', 180)
  const title = boundedIncidentText(value.title, 'Incident title', 180)
  const detail = boundedIncidentText(value.detail, 'Incident detail', 1_000)
  const fingerprint = optionalIncidentText(value.fingerprint, 180)
  const optional = (entry: unknown) => typeof entry === 'string' && entry.trim() ? entry.trim().slice(0, 180) : undefined
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target) ?? undefined
  // An unsaved workbench has no durable owner. Keeping its incidents would make
  // them reappear in unrelated blank sessions and break workspace isolation.
  if (!workspaceId) return { recorded: false }
  const last = target.prepare(`
    SELECT * FROM incident_events
    WHERE incident_key = ? AND workspace_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(incidentKey, workspaceId) as IncidentRow | undefined
  const latestHistoricalProvenance = (column: 'source_system' | 'source_ref') => {
    const row = target.prepare(`
      SELECT ${column} AS value FROM incident_events
      WHERE incident_key = ? AND workspace_id = ?
        AND ${column} IS NOT NULL AND TRIM(${column}) <> ''
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(incidentKey, workspaceId) as { value?: string } | undefined
    return optional(row?.value)
  }
  const transition = value.transition as IncidentEventInput['transition']
  if (last && fingerprint && last.fingerprint === fingerprint && last.transition === transition && last.severity === value.severity) return { recorded: false }
  if (transition === 'recovered' && (!last || last.transition === 'recovered')) return { recorded: false }
  if (transition === 'opened' && last && last.transition !== 'recovered') {
    const rank = { info: 0, warning: 1, critical: 2 }
    if (rank[value.severity as IncidentEventInput['severity']] <= rank[last.severity]) return { recorded: false }
  }
  const event: IncidentEvent = {
    id: `incident-${randomUUID()}`,
    workspaceId,
    incidentKey,
    transition: transition === 'opened' && last && last.transition !== 'recovered' ? 'worsened' : transition,
    severity: value.severity as IncidentEventInput['severity'],
    title,
    detail,
    sourceSystem: optional(value.sourceSystem) ?? optional(last?.source_system) ?? latestHistoricalProvenance('source_system'),
    sourceRef: optional(value.sourceRef) ?? optional(last?.source_ref) ?? latestHistoricalProvenance('source_ref'),
    fingerprint,
    cardId: optional(value.cardId),
    branchId: optional(value.branchId),
    versionId: optional(value.versionId),
    createdAt: new Date().toISOString(),
  }
  target.prepare(`
    INSERT INTO incident_events (id, workspace_id, incident_key, transition, severity, title, detail, source_system, source_ref, fingerprint, card_id, branch_id, version_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.id, event.workspaceId ?? null, event.incidentKey, event.transition, event.severity, event.title, event.detail, event.sourceSystem ?? null, event.sourceRef ?? null, event.fingerprint ?? null, event.cardId ?? null, event.branchId ?? null, event.versionId ?? null, event.createdAt)
  target.prepare("DELETE FROM incident_events WHERE julianday(created_at) < julianday('now', '-30 days')").run()
  return { recorded: true, event }
}

export function closeWorkspaceDatabase() { database?.close(); database = undefined }
