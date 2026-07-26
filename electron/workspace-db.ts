import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'

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
  draft_updated_at: string | null
  id: string
  name: string
  updated_at: string
}

type RelationalValueRow = {
  ordinal: number
  path: string
  value_type: 'null' | 'string' | 'number' | 'boolean' | 'object' | 'array'
  value_text: string | null
  value_boolean: number | null
}

type WorkspaceDocumentRow = {
  id: string
  workspace_id: string
  slot: 'committed' | 'draft'
  project_title: string | null
  project_title_present: number
  nodes_present: number
  edges_present: number
  versions_present: number
  settings_present: number
  inspector_open: number | null
  library_open: number | null
  updated_at: string
}

type GraphNodeRow = {
  node_id: string
  node_type: string | null
  ordinal: number
  position_present: number
  position_x: number | null
  position_y: number | null
  measured_present: number
  measured_width: number | null
  measured_height: number | null
}

type GraphEdgeRow = {
  edge_id: string
  source_id: string
  target_id: string
  edge_type: string | null
  edge_label: string | null
  source_handle: string | null
  target_handle: string | null
  ordinal: number
}

type WorkspaceVersionRow = {
  version_id: string
  ordinal: number
  label_present: number
  label: string
  created_at_present: number
  created_at: string
  origin_present: number
  origin: string
  nodes_present: number
  edges_present: number
  blocking_issues_present: number
  blocking_issues: number
  status: string | null
  description: string | null
  evidence_present: number
  snapshot_id: string
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

export type AgentProposalMemoryStatus = 'generated' | 'pending-review' | 'committed' | 'rejected' | 'invalid' | 'duplicate'

export interface AgentProposalMemoryEntry {
  id: string
  scopeId: string
  graphFingerprint: string
  baseGraphFingerprint: string
  status: AgentProposalMemoryStatus
  source: 'pipeline' | 'card-rework'
  title: string
  summary: string
  rationale: string
  occurrenceCount: number
  firstSeenAt: string
  lastSeenAt: string
  decidedAt?: string
  versionId?: string
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

type AgentProposalMemoryRow = {
  id: string
  workspace_id: string | null
  graph_fingerprint: string
  base_graph_fingerprint: string
  status: AgentProposalMemoryStatus
  source: AgentProposalMemoryEntry['source']
  title: string
  summary: string
  rationale: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  decided_at: string | null
  version_id: string | null
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function pointerToken(value: string) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function pointerSegments(path: string) {
  if (!path) return []
  return path.slice(1).split('/').map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function flattenRelationalValue(value: unknown) {
  const rows: Omit<RelationalValueRow, 'ordinal'>[] = []
  const visit = (current: unknown, path: string) => {
    if (current === null || current === undefined) {
      rows.push({ path, value_type: 'null', value_text: null, value_boolean: null })
      return
    }
    if (Array.isArray(current)) {
      rows.push({ path, value_type: 'array', value_text: null, value_boolean: null })
      current.forEach((entry, index) => visit(entry, `${path}/${index}`))
      return
    }
    if (typeof current === 'object') {
      rows.push({ path, value_type: 'object', value_text: null, value_boolean: null })
      Object.entries(current as Record<string, unknown>).forEach(([key, entry]) => {
        if (entry !== undefined) visit(entry, `${path}/${pointerToken(key)}`)
      })
      return
    }
    if (typeof current === 'string') {
      rows.push({ path, value_type: 'string', value_text: current, value_boolean: null })
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        rows.push({ path, value_type: 'null', value_text: null, value_boolean: null })
        return
      }
      rows.push({ path, value_type: 'number', value_text: String(current), value_boolean: null })
      return
    }
    if (typeof current === 'boolean') {
      rows.push({ path, value_type: 'boolean', value_text: null, value_boolean: current ? 1 : 0 })
      return
    }
    throw new Error(`Workspace contains an unsupported ${typeof current} value`)
  }
  visit(value, '')
  return rows.map((row, ordinal) => ({ ...row, ordinal }))
}

function materializeRelationalValue(rows: RelationalValueRow[]): unknown {
  if (!rows.length) return {}
  const valueFor = (row: RelationalValueRow): unknown => {
    if (row.value_type === 'object') return {}
    if (row.value_type === 'array') return []
    if (row.value_type === 'string') return row.value_text ?? ''
    if (row.value_type === 'number') return Number(row.value_text)
    if (row.value_type === 'boolean') return row.value_boolean === 1
    return null
  }
  const ordered = [...rows].sort((left, right) => left.ordinal - right.ordinal)
  let root = valueFor(ordered.find((row) => row.path === '') ?? ordered[0])
  for (const row of ordered) {
    const segments = pointerSegments(row.path)
    if (!segments.length) {
      root = valueFor(row)
      continue
    }
    let parent = root as Record<string, unknown> | unknown[]
    for (const segment of segments.slice(0, -1)) {
      parent = (parent as Record<string, unknown>)[segment] as Record<string, unknown> | unknown[]
    }
    const key = segments.at(-1)!
    if (Array.isArray(parent)) parent[Number(key)] = valueFor(row)
    else parent[key] = valueFor(row)
  }
  return root
}

type ValueTable =
  | 'workspace_document_values'
  | 'graph_node_values'
  | 'graph_edge_values'
  | 'workspace_version_values'
  | 'catalog_checkpoint_values'

function writeRelationalValues(
  target: DatabaseSync,
  table: ValueTable,
  ownerColumns: string[],
  ownerValues: Array<string | number>,
  value: unknown,
) {
  const columns = [...ownerColumns, 'path', 'ordinal', 'value_type', 'value_text', 'value_boolean']
  const placeholders = columns.map(() => '?').join(', ')
  const statement = target.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
  for (const row of flattenRelationalValue(value)) {
    statement.run(...ownerValues, row.path, row.ordinal, row.value_type, row.value_text, row.value_boolean)
  }
}

function readRelationalValues(
  target: DatabaseSync,
  table: ValueTable,
  where: string,
  values: Array<string | number>,
) {
  const rows = target.prepare(`
    SELECT path, ordinal, value_type, value_text, value_boolean
    FROM ${table} WHERE ${where} ORDER BY ordinal
  `).all(...values) as unknown as RelationalValueRow[]
  return materializeRelationalValue(rows)
}

function writeGraphSnapshot(target: DatabaseSync, documentId: string, snapshotId: string, versionId: string | null, nodes: unknown[], edges: unknown[]) {
  target.prepare('INSERT INTO graph_snapshots (id, document_id, version_id) VALUES (?, ?, ?)').run(snapshotId, documentId, versionId)
  const insertNode = target.prepare(`
    INSERT INTO graph_nodes (
      snapshot_id, node_id, ordinal, node_type, position_present, position_x, position_y,
      measured_present, measured_width, measured_height
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  nodes.forEach((input, ordinal) => {
    const node = record(input)
    if (typeof node.id !== 'string' || !node.id) throw new Error('Workspace node ID is required')
    const position = record(node.position)
    const measured = record(node.measured)
    const extras = Object.fromEntries(Object.entries(node).filter(([key]) => !['id', 'type', 'position', 'measured'].includes(key)))
    insertNode.run(
      snapshotId,
      node.id,
      ordinal,
      typeof node.type === 'string' ? node.type : null,
      node.position && typeof node.position === 'object' ? 1 : 0,
      typeof position.x === 'number' ? position.x : null,
      typeof position.y === 'number' ? position.y : null,
      node.measured && typeof node.measured === 'object' ? 1 : 0,
      typeof measured.width === 'number' ? measured.width : null,
      typeof measured.height === 'number' ? measured.height : null,
    )
    writeRelationalValues(target, 'graph_node_values', ['snapshot_id', 'node_id'], [snapshotId, node.id], extras)
  })
  const insertEdge = target.prepare(`
    INSERT INTO graph_edges (
      snapshot_id, edge_id, ordinal, source_id, target_id, edge_type, edge_label, source_handle, target_handle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  edges.forEach((input, ordinal) => {
    const edge = record(input)
    if (typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string') throw new Error('Workspace edge identity is invalid')
    const extras = Object.fromEntries(Object.entries(edge).filter(([key]) => !['id', 'source', 'target', 'type', 'label', 'sourceHandle', 'targetHandle'].includes(key)))
    insertEdge.run(
      snapshotId,
      edge.id,
      ordinal,
      edge.source,
      edge.target,
      typeof edge.type === 'string' ? edge.type : null,
      typeof edge.label === 'string' ? edge.label : null,
      typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
      typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
    )
    writeRelationalValues(target, 'graph_edge_values', ['snapshot_id', 'edge_id'], [snapshotId, edge.id], extras)
  })
}

function readGraphSnapshot(target: DatabaseSync, snapshotId: string) {
  const nodes = (target.prepare('SELECT * FROM graph_nodes WHERE snapshot_id = ? ORDER BY ordinal').all(snapshotId) as unknown as GraphNodeRow[]).map((row) => {
    const node: Record<string, unknown> = { id: row.node_id }
    if (row.node_type !== null) node.type = row.node_type
    if (row.position_present === 1) node.position = { x: row.position_x ?? 0, y: row.position_y ?? 0 }
    if (row.measured_present === 1) node.measured = { width: row.measured_width ?? 0, height: row.measured_height ?? 0 }
    return Object.assign(node, readRelationalValues(target, 'graph_node_values', 'snapshot_id = ? AND node_id = ?', [snapshotId, row.node_id]))
  })
  const edges = (target.prepare('SELECT * FROM graph_edges WHERE snapshot_id = ? ORDER BY ordinal').all(snapshotId) as unknown as GraphEdgeRow[]).map((row) => {
    const edge: Record<string, unknown> = { id: row.edge_id, source: row.source_id, target: row.target_id }
    if (row.edge_type !== null) edge.type = row.edge_type
    if (row.edge_label !== null) edge.label = row.edge_label
    if (row.source_handle !== null) edge.sourceHandle = row.source_handle
    if (row.target_handle !== null) edge.targetHandle = row.target_handle
    return Object.assign(edge, readRelationalValues(target, 'graph_edge_values', 'snapshot_id = ? AND edge_id = ?', [snapshotId, row.edge_id]))
  })
  return { nodes, edges }
}

function documentId(workspaceId: string, slot: 'committed' | 'draft') {
  return `${workspaceId}:${slot}`
}

function writeWorkspaceDocument(target: DatabaseSync, workspaceId: string, slot: 'committed' | 'draft', payload: unknown, updatedAt: string) {
  serializePayload(payload)
  const value = record(payload)
  const id = documentId(workspaceId, slot)
  target.prepare('DELETE FROM workspace_documents WHERE workspace_id = ? AND slot = ?').run(workspaceId, slot)
  const projectSettings = record(value.projectSettings)
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const edges = Array.isArray(value.edges) ? value.edges : []
  const versions = Array.isArray(value.versions) ? value.versions : []
  target.prepare(`
    INSERT INTO workspace_documents (
      id, workspace_id, slot, project_title, project_title_present, nodes_present, edges_present,
      versions_present, settings_present, inspector_open, library_open, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    slot,
    typeof value.projectTitle === 'string' ? value.projectTitle : null,
    Object.hasOwn(value, 'projectTitle') ? 1 : 0,
    Array.isArray(value.nodes) ? 1 : 0,
    Array.isArray(value.edges) ? 1 : 0,
    Array.isArray(value.versions) ? 1 : 0,
    value.projectSettings && typeof value.projectSettings === 'object' ? 1 : 0,
    typeof projectSettings.inspectorOpen === 'boolean' ? (projectSettings.inspectorOpen ? 1 : 0) : null,
    typeof projectSettings.libraryOpen === 'boolean' ? (projectSettings.libraryOpen ? 1 : 0) : null,
    updatedAt,
  )
  const extras = Object.fromEntries(Object.entries(value).filter(([key]) => !['projectTitle', 'nodes', 'edges', 'versions', 'projectSettings'].includes(key)))
  writeRelationalValues(target, 'workspace_document_values', ['document_id'], [id], extras)
  writeGraphSnapshot(target, id, `${id}:active`, null, nodes, edges)

  const insertVersion = target.prepare(`
    INSERT INTO workspace_versions (
      document_id, version_id, ordinal, label_present, label, created_at_present, created_at,
      origin_present, origin, nodes_present, edges_present, blocking_issues_present, blocking_issues,
      status, description, evidence_present, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEvidence = target.prepare(`
    INSERT INTO workspace_version_evidence (
      document_id, version_id, ordinal, connector_id, source_system, asset_ref,
      tool, urn, captured_at, expires_at, status, summary, cached, stale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  versions.forEach((input, ordinal) => {
    const version = record(input)
    if (typeof version.id !== 'string' || !version.id) throw new Error('Workspace version ID is required')
    const versionId = version.id
    const snapshotId = `${id}:version:${versionId}`
    const versionNodes = Array.isArray(version.nodes) ? version.nodes : []
    const versionEdges = Array.isArray(version.edges) ? version.edges : []
    writeGraphSnapshot(target, id, snapshotId, versionId, versionNodes, versionEdges)
    insertVersion.run(
      id,
      versionId,
      ordinal,
      Object.hasOwn(version, 'label') ? 1 : 0,
      typeof version.label === 'string' ? version.label : '',
      Object.hasOwn(version, 'createdAt') ? 1 : 0,
      typeof version.createdAt === 'string' ? version.createdAt : updatedAt,
      Object.hasOwn(version, 'origin') ? 1 : 0,
      typeof version.origin === 'string' ? version.origin : 'manual',
      Array.isArray(version.nodes) ? 1 : 0,
      Array.isArray(version.edges) ? 1 : 0,
      Object.hasOwn(version, 'blockingIssues') ? 1 : 0,
      typeof version.blockingIssues === 'number' ? version.blockingIssues : 0,
      typeof version.status === 'string' ? version.status : null,
      typeof version.description === 'string' ? version.description : null,
      Array.isArray(version.evidence) ? 1 : 0,
      snapshotId,
    )
    const versionExtras = Object.fromEntries(Object.entries(version).filter(([key]) => !['id', 'label', 'createdAt', 'origin', 'nodes', 'edges', 'blockingIssues', 'status', 'description', 'evidence'].includes(key)))
    writeRelationalValues(target, 'workspace_version_values', ['document_id', 'version_id'], [id, versionId], versionExtras)
    if (Array.isArray(version.evidence)) version.evidence.forEach((evidenceInput, evidenceOrdinal) => {
      const evidence = record(evidenceInput)
      insertEvidence.run(
        id,
        versionId,
        evidenceOrdinal,
        typeof evidence.connectorId === 'string' ? evidence.connectorId : null,
        typeof evidence.sourceSystem === 'string' ? evidence.sourceSystem : null,
        typeof evidence.assetRef === 'string' ? evidence.assetRef : null,
        typeof evidence.tool === 'string' ? evidence.tool : '',
        typeof evidence.urn === 'string' ? evidence.urn : '',
        typeof evidence.capturedAt === 'string' ? evidence.capturedAt : '',
        typeof evidence.expiresAt === 'string' ? evidence.expiresAt : '',
        typeof evidence.status === 'string' ? evidence.status : 'unavailable',
        typeof evidence.summary === 'string' ? evidence.summary : '',
        evidence.cached === true ? 1 : 0,
        evidence.stale === true ? 1 : 0,
      )
    })
  })
}

function readWorkspaceDocument(target: DatabaseSync, workspaceId: string, slot: 'committed' | 'draft'): unknown | null {
  const row = target.prepare('SELECT * FROM workspace_documents WHERE workspace_id = ? AND slot = ?').get(workspaceId, slot) as WorkspaceDocumentRow | undefined
  if (!row) return null
  const payload = record(readRelationalValues(target, 'workspace_document_values', 'document_id = ?', [row.id]))
  if (row.project_title_present === 1) payload.projectTitle = row.project_title ?? ''
  const activeGraph = readGraphSnapshot(target, `${row.id}:active`)
  if (row.nodes_present === 1) payload.nodes = activeGraph.nodes
  if (row.edges_present === 1) payload.edges = activeGraph.edges
  if (row.versions_present === 1) {
    payload.versions = (target.prepare('SELECT * FROM workspace_versions WHERE document_id = ? ORDER BY ordinal').all(row.id) as unknown as WorkspaceVersionRow[]).map((version) => {
      const graph = readGraphSnapshot(target, version.snapshot_id)
      const result: Record<string, unknown> = { id: version.version_id }
      if (version.label_present === 1) result.label = version.label
      if (version.created_at_present === 1) result.createdAt = version.created_at
      if (version.origin_present === 1) result.origin = version.origin
      if (version.nodes_present === 1) result.nodes = graph.nodes
      if (version.edges_present === 1) result.edges = graph.edges
      if (version.blocking_issues_present === 1) result.blockingIssues = version.blocking_issues
      if (version.status !== null) result.status = version.status
      if (version.description !== null) result.description = version.description
      Object.assign(result, readRelationalValues(target, 'workspace_version_values', 'document_id = ? AND version_id = ?', [row.id, version.version_id]))
      const evidence = target.prepare(`
        SELECT * FROM workspace_version_evidence
        WHERE document_id = ? AND version_id = ? ORDER BY ordinal
      `).all(row.id, version.version_id) as unknown as Array<Record<string, unknown>>
      if (version.evidence_present === 1) result.evidence = evidence.map((item) => ({
        ...(typeof item.connector_id === 'string' ? { connectorId: item.connector_id } : {}),
        ...(typeof item.source_system === 'string' ? { sourceSystem: item.source_system } : {}),
        ...(typeof item.asset_ref === 'string' ? { assetRef: item.asset_ref } : {}),
        tool: item.tool,
        urn: item.urn,
        capturedAt: item.captured_at,
        expiresAt: item.expires_at,
        status: item.status,
        summary: item.summary,
        cached: item.cached === 1,
        stale: item.stale === 1,
      }))
      return result
    })
  }
  if (row.settings_present === 1) {
    payload.projectSettings = {
      ...(row.inspector_open !== null ? { inspectorOpen: row.inspector_open === 1 } : {}),
      ...(row.library_open !== null ? { libraryOpen: row.library_open === 1 } : {}),
    }
  }
  return payload
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

function tableExists(target: DatabaseSync, table: string) {
  return Boolean(target.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function tableColumns(target: DatabaseSync, table: string) {
  if (!tableExists(target, table)) return new Set<string>()
  return new Set((target.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((column) => column.name))
}

function migrateRelationalStorage(target: DatabaseSync, databasePath: string) {
  const workspaceColumns = tableColumns(target, 'workspaces')
  const checkpointColumns = tableColumns(target, 'catalog_checkpoints')
  const legacyWorkspaceState = tableExists(target, 'workspace_state')
  const needsMigration = workspaceColumns.has('payload') || workspaceColumns.has('draft_payload') || checkpointColumns.has('payload') || legacyWorkspaceState
  if (!needsMigration) {
    target.exec('PRAGMA user_version = 2')
    return
  }

  const backupPath = databasePath.replace(/\.sqlite$/, '.pre-relational-v1.sqlite')
  if (!existsSync(backupPath)) {
    target.exec('PRAGMA wal_checkpoint(FULL)')
    copyFileSync(databasePath, backupPath)
  }

  target.exec('BEGIN IMMEDIATE')
  try {
    const workspaceCount = target.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number }
    if (Number(workspaceCount.count) === 0 && legacyWorkspaceState) {
      const legacy = target.prepare('SELECT payload, updated_at FROM workspace_state WHERE id = 1').get() as { payload?: unknown; updated_at?: unknown } | undefined
      const payload = parsePayload(legacy?.payload)
      if (payload !== null && typeof legacy?.payload === 'string') {
        const suggestedName = record(payload).projectTitle
        const name = typeof suggestedName === 'string' && suggestedName.trim() ? normalizeWorkspaceName(suggestedName) : 'Migrated workspace'
        const timestamp = typeof legacy.updated_at === 'string' ? legacy.updated_at : new Date().toISOString()
        const id = `workspace-${randomUUID()}`
        if (workspaceColumns.has('payload')) {
          target.prepare(`
            INSERT INTO workspaces (id, name, payload, archived, dirty, created_at, updated_at)
            VALUES (?, ?, ?, 0, 0, ?, ?)
          `).run(id, name, legacy.payload, timestamp, timestamp)
        } else {
          target.prepare(`
            INSERT INTO workspaces (id, name, archived, dirty, created_at, updated_at)
            VALUES (?, ?, 0, 0, ?, ?)
          `).run(id, name, timestamp, timestamp)
          writeWorkspaceDocument(target, id, 'committed', payload, timestamp)
        }
        writeSetting(target, ACTIVE_WORKSPACE_KEY, id)
      }
    }

    if (workspaceColumns.has('payload')) {
      const legacyRows = target.prepare(`
        SELECT id, payload, draft_payload, updated_at, draft_updated_at, dirty FROM workspaces
      `).all() as unknown as Array<{
        id: string
        payload: string
        draft_payload: string | null
        updated_at: string
        draft_updated_at: string | null
        dirty: number
      }>
      for (const row of legacyRows) {
        const payload = parsePayload(row.payload)
        if (payload === null) throw new Error(`Workspace ${row.id} contains invalid legacy JSON`)
        writeWorkspaceDocument(target, row.id, 'committed', payload, row.updated_at)
        if (row.dirty === 1 && row.draft_payload !== null) {
          const draft = parsePayload(row.draft_payload)
          if (draft === null) throw new Error(`Workspace ${row.id} contains an invalid legacy draft`)
          writeWorkspaceDocument(target, row.id, 'draft', draft, row.draft_updated_at ?? row.updated_at)
        }
      }
      if (workspaceColumns.has('draft_payload')) target.exec('ALTER TABLE workspaces DROP COLUMN draft_payload')
      target.exec('ALTER TABLE workspaces DROP COLUMN payload')
    }

    if (checkpointColumns.has('payload')) {
      const checkpoints = target.prepare('SELECT scope_id, checkpoint_key, payload FROM catalog_checkpoints').all() as unknown as Array<{
        scope_id: string
        checkpoint_key: string
        payload: string
      }>
      for (const checkpoint of checkpoints) {
        const payload = parsePayload(checkpoint.payload)
        if (payload === null) throw new Error(`Catalog checkpoint ${checkpoint.checkpoint_key} contains invalid legacy JSON`)
        writeRelationalValues(
          target,
          'catalog_checkpoint_values',
          ['scope_id', 'checkpoint_key'],
          [checkpoint.scope_id, checkpoint.checkpoint_key],
          payload,
        )
      }
      target.exec('ALTER TABLE catalog_checkpoints DROP COLUMN payload')
    }

    if (legacyWorkspaceState) target.exec('DROP TABLE workspace_state')
    target.exec('PRAGMA user_version = 2')
    target.exec('COMMIT')
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}

function db(userDataDirectory: string) {
  if (database) return database
  const databasePath = join(userDataDirectory, 'sam-lab.sqlite')
  database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      draft_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS workspaces_archived_updated_idx ON workspaces (archived, updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspace_documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('committed', 'draft')),
      project_title TEXT,
      project_title_present INTEGER NOT NULL CHECK (project_title_present IN (0, 1)),
      nodes_present INTEGER NOT NULL CHECK (nodes_present IN (0, 1)),
      edges_present INTEGER NOT NULL CHECK (edges_present IN (0, 1)),
      versions_present INTEGER NOT NULL CHECK (versions_present IN (0, 1)),
      settings_present INTEGER NOT NULL CHECK (settings_present IN (0, 1)),
      inspector_open INTEGER CHECK (inspector_open IN (0, 1)),
      library_open INTEGER CHECK (library_open IN (0, 1)),
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, slot),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_document_values (
      document_id TEXT NOT NULL,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array')),
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
      PRIMARY KEY (document_id, path),
      FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS graph_snapshots (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_id TEXT,
      FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS graph_nodes (
      snapshot_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      node_type TEXT,
      position_present INTEGER NOT NULL CHECK (position_present IN (0, 1)),
      position_x REAL,
      position_y REAL,
      measured_present INTEGER NOT NULL CHECK (measured_present IN (0, 1)),
      measured_width REAL,
      measured_height REAL,
      PRIMARY KEY (snapshot_id, node_id),
      FOREIGN KEY (snapshot_id) REFERENCES graph_snapshots(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS graph_node_values (
      snapshot_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array')),
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
      PRIMARY KEY (snapshot_id, node_id, path),
      FOREIGN KEY (snapshot_id, node_id) REFERENCES graph_nodes(snapshot_id, node_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS graph_edges (
      snapshot_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT,
      edge_label TEXT,
      source_handle TEXT,
      target_handle TEXT,
      PRIMARY KEY (snapshot_id, edge_id),
      FOREIGN KEY (snapshot_id) REFERENCES graph_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (snapshot_id, source_id) REFERENCES graph_nodes(snapshot_id, node_id),
      FOREIGN KEY (snapshot_id, target_id) REFERENCES graph_nodes(snapshot_id, node_id)
    );
    CREATE TABLE IF NOT EXISTS graph_edge_values (
      snapshot_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array')),
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
      PRIMARY KEY (snapshot_id, edge_id, path),
      FOREIGN KEY (snapshot_id, edge_id) REFERENCES graph_edges(snapshot_id, edge_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_versions (
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      label_present INTEGER NOT NULL CHECK (label_present IN (0, 1)),
      label TEXT NOT NULL,
      created_at_present INTEGER NOT NULL CHECK (created_at_present IN (0, 1)),
      created_at TEXT NOT NULL,
      origin_present INTEGER NOT NULL CHECK (origin_present IN (0, 1)),
      origin TEXT NOT NULL,
      nodes_present INTEGER NOT NULL CHECK (nodes_present IN (0, 1)),
      edges_present INTEGER NOT NULL CHECK (edges_present IN (0, 1)),
      blocking_issues_present INTEGER NOT NULL CHECK (blocking_issues_present IN (0, 1)),
      blocking_issues INTEGER NOT NULL,
      status TEXT,
      description TEXT,
      evidence_present INTEGER NOT NULL CHECK (evidence_present IN (0, 1)),
      snapshot_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY (document_id, version_id),
      FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (snapshot_id) REFERENCES graph_snapshots(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_version_values (
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array')),
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
      PRIMARY KEY (document_id, version_id, path),
      FOREIGN KEY (document_id, version_id) REFERENCES workspace_versions(document_id, version_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_version_evidence (
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      connector_id TEXT,
      source_system TEXT,
      asset_ref TEXT,
      tool TEXT NOT NULL,
      urn TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      cached INTEGER NOT NULL CHECK (cached IN (0, 1)),
      stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
      PRIMARY KEY (document_id, version_id, ordinal),
      FOREIGN KEY (document_id, version_id) REFERENCES workspace_versions(document_id, version_id) ON DELETE CASCADE
    );
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
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, checkpoint_key)
    );
    CREATE TABLE IF NOT EXISTS catalog_checkpoint_values (
      scope_id TEXT NOT NULL,
      checkpoint_key TEXT NOT NULL,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type IN ('null', 'string', 'number', 'boolean', 'object', 'array')),
      value_text TEXT,
      value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
      PRIMARY KEY (scope_id, checkpoint_key, path),
      FOREIGN KEY (scope_id, checkpoint_key) REFERENCES catalog_checkpoints(scope_id, checkpoint_key) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_proposal_memory (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      graph_fingerprint TEXT NOT NULL,
      base_graph_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('generated', 'pending-review', 'committed', 'rejected', 'invalid', 'duplicate')),
      source TEXT NOT NULL CHECK (source IN ('pipeline', 'card-rework')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      decided_at TEXT,
      version_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_proposal_memory_workspace_graph_idx
      ON agent_proposal_memory (workspace_id, graph_fingerprint) WHERE workspace_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS agent_proposal_memory_workbench_graph_idx
      ON agent_proposal_memory (graph_fingerprint) WHERE workspace_id IS NULL;
    CREATE INDEX IF NOT EXISTS agent_proposal_memory_workspace_time_idx
      ON agent_proposal_memory (workspace_id, last_seen_at DESC);
  `)
  const incidentColumns = database.prepare('PRAGMA table_info(incident_events)').all() as unknown as { name: string }[]
  if (!incidentColumns.some((column) => column.name === 'fingerprint')) database.exec('ALTER TABLE incident_events ADD COLUMN fingerprint TEXT')
  if (!incidentColumns.some((column) => column.name === 'source_system')) database.exec('ALTER TABLE incident_events ADD COLUMN source_system TEXT')
  if (!incidentColumns.some((column) => column.name === 'source_ref')) database.exec('ALTER TABLE incident_events ADD COLUMN source_ref TEXT')
  migrateRelationalStorage(database, databasePath)
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

function runTransaction<T>(target: DatabaseSync, operation: () => T): T {
  target.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    target.exec('COMMIT')
    return result
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}

function promoteWorkspaceDraft(target: DatabaseSync, workspaceId: string) {
  const row = readWorkspaceRow(target, workspaceId)
  if (!row || row.dirty !== 1) return
  const draft = readWorkspaceDocument(target, workspaceId, 'draft')
  if (draft !== null) writeWorkspaceDocument(target, workspaceId, 'committed', draft, row.draft_updated_at ?? row.updated_at)
  target.prepare("DELETE FROM workspace_documents WHERE workspace_id = ? AND slot = 'draft'").run(workspaceId)
  target.prepare(`
    UPDATE workspaces
    SET dirty = 0, updated_at = COALESCE(draft_updated_at, updated_at), draft_updated_at = NULL
    WHERE id = ?
  `).run(workspaceId)
}

function promoteActiveWorkspaceDraft(target: DatabaseSync) {
  const workspaceId = activeWorkspaceId(target)
  if (workspaceId) promoteWorkspaceDraft(target, workspaceId)
}

function currentState(target: DatabaseSync, uncleanShutdown: boolean): WorkspaceManagerState {
  const workspaceId = activeWorkspaceId(target)
  const row = workspaceId ? readWorkspaceRow(target, workspaceId) : undefined
  const payload = row ? readWorkspaceDocument(target, row.id, 'committed') : null
  const activeWorkspace = row && payload !== null ? { ...rowToSummary(row), payload } : undefined
  const draft = row?.dirty === 1 ? readWorkspaceDocument(target, row.id, 'draft') : null
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
  if (!activeWorkspaceId(target)) {
    target.prepare("DELETE FROM catalog_checkpoints WHERE scope_id = 'workbench'").run()
    target.prepare('DELETE FROM agent_proposal_memory WHERE workspace_id IS NULL').run()
  }
  writeSetting(target, CLEAN_SHUTDOWN_KEY, 'false')
  return uncleanShutdown
}

export function markWorkspaceSessionClean(userDataDirectory: string) {
  const target = db(userDataDirectory)
  runTransaction(target, () => {
    const dirty = target.prepare('SELECT id FROM workspaces WHERE dirty = 1').all() as unknown as { id: string }[]
    dirty.forEach((workspace) => promoteWorkspaceDraft(target, workspace.id))
    writeSetting(target, CLEAN_SHUTDOWN_KEY, 'true')
  })
}

export function loadWorkspaceManagerState(userDataDirectory: string, uncleanShutdown = false) {
  return currentState(db(userDataDirectory), uncleanShutdown)
}

export function listWorkspaces(userDataDirectory: string) {
  return currentState(db(userDataDirectory), false).workspaces
}

export function createWorkspace(userDataDirectory: string, name: unknown, payload: unknown) {
  serializePayload(payload)
  const normalizedName = normalizeWorkspaceName(name)
  const target = db(userDataDirectory)
  const previousWorkspaceId = activeWorkspaceId(target)
  const id = `workspace-${randomUUID()}`
  const timestamp = new Date().toISOString()
  runTransaction(target, () => {
    promoteActiveWorkspaceDraft(target)
    target.prepare(`
      INSERT INTO workspaces (id, name, archived, dirty, created_at, updated_at)
      VALUES (?, ?, 0, 0, ?, ?)
    `).run(id, normalizedName, timestamp, timestamp)
    writeWorkspaceDocument(target, id, 'committed', payload, timestamp)
    if (!previousWorkspaceId) {
      target.prepare('UPDATE agent_proposal_memory SET workspace_id = ? WHERE workspace_id IS NULL').run(id)
      target.prepare("UPDATE catalog_checkpoints SET scope_id = ? WHERE scope_id = 'workbench'").run(id)
    }
    writeSetting(target, ACTIVE_WORKSPACE_KEY, id)
  })
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
  const payload = readWorkspaceDocument(target, workspaceId, source.dirty === 1 ? 'draft' : 'committed')
    ?? readWorkspaceDocument(target, workspaceId, 'committed')
  if (payload === null) throw new Error('Workspace document is missing')
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
  runTransaction(target, () => {
    if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) promoteWorkspaceDraft(target, workspaceId)
    const result = target.prepare('UPDATE workspaces SET archived = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), workspaceId)
    if (Number(result.changes) !== 1) throw new Error('Workspace not found')
    if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) clearActiveWorkspace(target)
  })
  return currentState(target, false)
}

export function deleteWorkspace(userDataDirectory: string, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  if (readSetting(target, ACTIVE_WORKSPACE_KEY) === workspaceId) throw new Error('The active workspace cannot be deleted')
  const workspace = readWorkspaceRow(target, workspaceId)
  if (!workspace || workspace.archived !== 1) throw new Error('Only an archived workspace can be deleted')
  runTransaction(target, () => {
    target.prepare('DELETE FROM incident_events WHERE workspace_id = ?').run(workspaceId)
    target.prepare('DELETE FROM catalog_checkpoints WHERE scope_id = ?').run(workspaceId)
    target.prepare('DELETE FROM agent_proposal_memory WHERE workspace_id = ?').run(workspaceId)
    target.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
  })
  return currentState(target, false)
}

export function openWorkspace(userDataDirectory: string, workspaceId: unknown) {
  if (typeof workspaceId !== 'string') throw new Error('Invalid workspace ID')
  const target = db(userDataDirectory)
  const workspace = readWorkspaceRow(target, workspaceId)
  if (!workspace || workspace.archived === 1) throw new Error('Workspace not found or archived')
  runTransaction(target, () => {
    promoteActiveWorkspaceDraft(target)
    writeSetting(target, ACTIVE_WORKSPACE_KEY, workspaceId)
  })
  return currentState(target, false)
}

export function autosaveWorkspaceDraft(userDataDirectory: string, payload: unknown) {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) return { saved: false as const, reason: 'no-active-workspace' as const }
  serializePayload(payload)
  const timestamp = new Date().toISOString()
  runTransaction(target, () => {
    writeWorkspaceDocument(target, workspaceId, 'draft', payload, timestamp)
    target.prepare('UPDATE workspaces SET dirty = 1, draft_updated_at = ? WHERE id = ?').run(timestamp, workspaceId)
  })
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
  const scopeId = catalogCheckpointScope(target)
  const exists = target.prepare('SELECT 1 FROM catalog_checkpoints WHERE scope_id = ? AND checkpoint_key = ?').get(scopeId, key)
  return exists ? readRelationalValues(target, 'catalog_checkpoint_values', 'scope_id = ? AND checkpoint_key = ?', [scopeId, key]) : null
}

export function saveCatalogCheckpoint(userDataDirectory: string, checkpointKey: unknown, payload: unknown) {
  const target = db(userDataDirectory)
  const key = normalizeCatalogCheckpointKey(checkpointKey)
  const scopeId = catalogCheckpointScope(target)
  serializePayload(payload)
  const updatedAt = new Date().toISOString()
  runTransaction(target, () => {
    target.prepare(`
      INSERT INTO catalog_checkpoints (scope_id, checkpoint_key, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(scope_id, checkpoint_key) DO UPDATE SET updated_at = excluded.updated_at
    `).run(scopeId, key, updatedAt)
    target.prepare('DELETE FROM catalog_checkpoint_values WHERE scope_id = ? AND checkpoint_key = ?').run(scopeId, key)
    writeRelationalValues(target, 'catalog_checkpoint_values', ['scope_id', 'checkpoint_key'], [scopeId, key], payload)
  })
  return { saved: true as const, scopeId, updatedAt }
}

export function commitActiveWorkspace(userDataDirectory: string, payload: unknown) {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) throw new Error('Create a workspace before saving')
  serializePayload(payload)
  const timestamp = new Date().toISOString()
  runTransaction(target, () => {
    writeWorkspaceDocument(target, workspaceId, 'committed', payload, timestamp)
    target.prepare("DELETE FROM workspace_documents WHERE workspace_id = ? AND slot = 'draft'").run(workspaceId)
    target.prepare(`
      UPDATE workspaces SET dirty = 0, updated_at = ?, draft_updated_at = NULL WHERE id = ?
    `).run(timestamp, workspaceId)
  })
  return { saved: true as const, workspaceId, updatedAt: timestamp }
}

export function resolveWorkspaceRecovery(userDataDirectory: string, action: unknown) {
  if (action !== 'recover' && action !== 'discard') throw new Error('Invalid recovery action')
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  if (!workspaceId) return currentState(target, false)
  runTransaction(target, () => {
    if (action === 'recover') promoteWorkspaceDraft(target, workspaceId)
    else {
      target.prepare("DELETE FROM workspace_documents WHERE workspace_id = ? AND slot = 'draft'").run(workspaceId)
      target.prepare('UPDATE workspaces SET dirty = 0, draft_updated_at = NULL WHERE id = ?').run(workspaceId)
    }
  })
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

function normalizeGraphFingerprint(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{16,128}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function proposalMemoryFromRow(row: AgentProposalMemoryRow): AgentProposalMemoryEntry {
  return {
    id: row.id,
    scopeId: row.workspace_id ?? 'workbench',
    graphFingerprint: row.graph_fingerprint,
    baseGraphFingerprint: row.base_graph_fingerprint,
    status: row.status,
    source: row.source,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    decidedAt: row.decided_at ?? undefined,
    versionId: row.version_id ?? undefined,
  }
}

function proposalMemoryRow(target: DatabaseSync, workspaceId: string | null, graphFingerprint: string) {
  const row = workspaceId
    ? target.prepare('SELECT * FROM agent_proposal_memory WHERE workspace_id = ? AND graph_fingerprint = ?').get(workspaceId, graphFingerprint)
    : target.prepare('SELECT * FROM agent_proposal_memory WHERE workspace_id IS NULL AND graph_fingerprint = ?').get(graphFingerprint)
  return row as AgentProposalMemoryRow | undefined
}

export function rememberAgentProposal(userDataDirectory: string, payload: unknown): AgentProposalMemoryEntry {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid agent proposal memory')
  const value = payload as Record<string, unknown>
  const graphFingerprint = normalizeGraphFingerprint(value.graphFingerprint, 'proposal graph fingerprint')
  const baseGraphFingerprint = normalizeGraphFingerprint(value.baseGraphFingerprint, 'base graph fingerprint')
  if (value.source !== 'pipeline' && value.source !== 'card-rework') throw new Error('Invalid proposal source')
  const title = boundedIncidentText(value.title, 'Proposal title', 180)
  const summary = boundedIncidentText(value.summary, 'Proposal summary', 1_000)
  const rationale = boundedIncidentText(value.rationale, 'Proposal rationale', 1_500)
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  const timestamp = new Date().toISOString()
  target.prepare(`
    INSERT INTO agent_proposal_memory (
      id, workspace_id, graph_fingerprint, base_graph_fingerprint, status, source,
      title, summary, rationale, occurrence_count, first_seen_at, last_seen_at
    )
    VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT DO UPDATE SET
      base_graph_fingerprint = excluded.base_graph_fingerprint,
      source = excluded.source,
      title = excluded.title,
      summary = excluded.summary,
      rationale = excluded.rationale,
      occurrence_count = agent_proposal_memory.occurrence_count + 1,
      last_seen_at = excluded.last_seen_at
  `).run(
    `proposal-memory-${randomUUID()}`,
    workspaceId,
    graphFingerprint,
    baseGraphFingerprint,
    value.source,
    title,
    summary,
    rationale,
    timestamp,
    timestamp,
  )
  const row = proposalMemoryRow(target, workspaceId, graphFingerprint)
  if (!row) throw new Error('Agent proposal memory was not persisted')
  return proposalMemoryFromRow(row)
}

export function listAgentProposalMemory(userDataDirectory: string, limit = 40): AgentProposalMemoryEntry[] {
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  const boundedLimit = Math.max(1, Math.min(100, Math.round(limit)))
  const rows = workspaceId
    ? target.prepare('SELECT * FROM agent_proposal_memory WHERE workspace_id = ? ORDER BY last_seen_at DESC, rowid DESC LIMIT ?').all(workspaceId, boundedLimit)
    : target.prepare('SELECT * FROM agent_proposal_memory WHERE workspace_id IS NULL ORDER BY last_seen_at DESC, rowid DESC LIMIT ?').all(boundedLimit)
  return (rows as unknown as AgentProposalMemoryRow[]).map(proposalMemoryFromRow)
}

export function updateAgentProposalMemoryStatus(
  userDataDirectory: string,
  graphFingerprintValue: unknown,
  statusValue: unknown,
  versionIdValue?: unknown,
): AgentProposalMemoryEntry | undefined {
  const graphFingerprint = normalizeGraphFingerprint(graphFingerprintValue, 'proposal graph fingerprint')
  const statuses = new Set<AgentProposalMemoryStatus>(['generated', 'pending-review', 'committed', 'rejected', 'invalid', 'duplicate'])
  if (typeof statusValue !== 'string' || !statuses.has(statusValue as AgentProposalMemoryStatus)) throw new Error('Invalid proposal memory status')
  const status = statusValue as AgentProposalMemoryStatus
  const versionId = typeof versionIdValue === 'string' && versionIdValue.trim() ? versionIdValue.trim().slice(0, 180) : null
  const decidedAt = status === 'generated' || status === 'pending-review' ? null : new Date().toISOString()
  const target = db(userDataDirectory)
  const workspaceId = activeWorkspaceId(target)
  const result = workspaceId
    ? target.prepare(`
        UPDATE agent_proposal_memory
        SET status = ?, version_id = COALESCE(?, version_id), decided_at = ?
        WHERE workspace_id = ? AND graph_fingerprint = ?
      `).run(status, versionId, decidedAt, workspaceId, graphFingerprint)
    : target.prepare(`
        UPDATE agent_proposal_memory
        SET status = ?, version_id = COALESCE(?, version_id), decided_at = ?
        WHERE workspace_id IS NULL AND graph_fingerprint = ?
      `).run(status, versionId, decidedAt, graphFingerprint)
  if (Number(result.changes) !== 1) return undefined
  const row = proposalMemoryRow(target, workspaceId, graphFingerprint)
  if (!row) return undefined
  return proposalMemoryFromRow(row)
}

export function closeWorkspaceDatabase() { database?.close(); database = undefined }
