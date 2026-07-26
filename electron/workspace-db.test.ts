import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveWorkspace,
  clearIncidentEvents,
  autosaveWorkspaceDraft,
  beginWorkspaceSession,
  closeWorkspaceDatabase,
  commitActiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  listWorkspaces,
  listIncidentEvents,
  loadAppSetting,
  loadCatalogCheckpoint,
  loadSavedWorkspace,
  loadWorkspaceManagerState,
  markWorkspaceSessionClean,
  openWorkspace,
  recordIncidentEvent,
  renameWorkspace,
  resolveWorkspaceRecovery,
  saveAppSetting,
  saveCatalogCheckpoint,
  saveWorkspace,
} from './workspace-db.js'

let testDirectory: string | undefined

function directory(label = 'workspace') {
  testDirectory = mkdtempSync(join(tmpdir(), `sam-lab-${label}-`))
  return testDirectory
}

afterEach(() => {
  closeWorkspaceDatabase()
  if (testDirectory) rmSync(testDirectory, { force: true, recursive: true })
  testDirectory = undefined
})

describe('SQLite workspace persistence', () => {
  it('starts with a blank workbench on a new installation', () => {
    const target = directory('blank')
    const state = loadWorkspaceManagerState(target)

    expect(state.activeWorkspace).toBeUndefined()
    expect(state.activeWorkspaceId).toBeNull()
    expect(state.workspaces).toEqual([])
    expect(autosaveWorkspaceDraft(target, { nodes: [{ id: 'example' }] })).toEqual({ saved: false, reason: 'no-active-workspace' })
  })

  it('does not persist or expose incidents for an unsaved blank workbench', () => {
    const target = directory('blank-incidents')
    expect(recordIncidentEvent(target, {
      incidentKey: 'connector:blank',
      transition: 'opened',
      severity: 'warning',
      title: 'Temporary connector warning',
      detail: 'This unsaved workbench has no durable incident owner.',
    })).toEqual({ recorded: false })
    expect(listIncidentEvents(target)).toEqual([])

    closeWorkspaceDatabase()
    const legacy = new DatabaseSync(join(target, 'sam-lab.sqlite'))
    legacy.prepare(`
      INSERT INTO incident_events (id, workspace_id, incident_key, transition, severity, title, detail, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
    `).run('legacy-blank-incident', 'legacy:blank', 'opened', 'warning', 'Legacy blank incident', 'Written by an older release.', new Date().toISOString())
    legacy.close()

    expect(listIncidentEvents(target)).toEqual([])
    expect(clearIncidentEvents(target)).toEqual({ deleted: 0, workspaceId: undefined })
  })

  it('persists catalog coverage for the unsaved workbench without saving its graph', () => {
    const target = directory('catalog-checkpoint')
    const progress = { inspected: 8, total: 67, datasets: [{ urn: 'urn:li:dataset:test-1' }] }

    expect(saveCatalogCheckpoint(target, 'catalog:deadbeef', progress)).toMatchObject({ saved: true, scopeId: 'workbench' })
    expect(loadCatalogCheckpoint(target, 'catalog:deadbeef')).toEqual(progress)
    expect(loadWorkspaceManagerState(target).activeWorkspaceId).toBeNull()

    closeWorkspaceDatabase()
    expect(loadCatalogCheckpoint(target, 'catalog:deadbeef')).toEqual(progress)
  })

  it('isolates catalog checkpoints by active workspace', () => {
    const target = directory('catalog-workspaces')
    const first = createWorkspace(target, 'First', { nodes: [] })
    saveCatalogCheckpoint(target, 'catalog:shared', { inspected: 4 })
    const second = createWorkspace(target, 'Second', { nodes: [] })
    saveCatalogCheckpoint(target, 'catalog:shared', { inspected: 12 })

    openWorkspace(target, first.activeWorkspaceId!)
    expect(loadCatalogCheckpoint(target, 'catalog:shared')).toEqual({ inspected: 4 })
    openWorkspace(target, second.activeWorkspaceId!)
    expect(loadCatalogCheckpoint(target, 'catalog:shared')).toEqual({ inspected: 12 })
  })

  it('migrates the legacy singleton without losing review history', () => {
    const target = directory('migration')
    const legacy = new DatabaseSync(join(target, 'sam-lab.sqlite'))
    legacy.exec('CREATE TABLE workspace_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)')
    const payload = {
      projectTitle: 'Customer activation',
      nodes: [{ id: 'active-source' }],
      edges: [],
      versions: [{ id: 'v-review', status: 'pending-review', description: 'Upgrade: mask email' }],
    }
    legacy.prepare('INSERT INTO workspace_state (id, payload, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(payload), '2026-07-20T08:00:00.000Z')
    legacy.close()

    const state = loadWorkspaceManagerState(target)
    expect(state.activeWorkspace?.name).toBe('Customer activation')
    expect(state.activeWorkspace?.payload).toEqual(payload)
    expect(state.workspaces).toHaveLength(1)
    expect(loadSavedWorkspace(target)).toEqual(payload)
  })

  it('creates, renames, duplicates, opens and archives independent workspaces', () => {
    const target = directory('manager')
    const firstPayload = { projectTitle: 'Marketing', nodes: [{ id: 'source-a' }], projectSettings: { inspectorOpen: false, libraryOpen: true } }
    const first = createWorkspace(target, 'Marketing', firstPayload)
    const firstId = first.activeWorkspaceId!
    renameWorkspace(target, firstId, 'Marketing governed')
    const duplicate = duplicateWorkspace(target, firstId)
    const duplicateId = duplicate.activeWorkspaceId!

    expect(duplicateId).not.toBe(firstId)
    expect(duplicate.activeWorkspace?.name).toBe('Marketing governed copy')
    expect(duplicate.activeWorkspace?.payload).toEqual(firstPayload)

    const reopened = openWorkspace(target, firstId)
    expect(reopened.activeWorkspace?.name).toBe('Marketing governed')
    const afterArchive = archiveWorkspace(target, firstId)
    expect(afterArchive.activeWorkspaceId).toBe(duplicateId)
    expect(afterArchive.workspaces.find((workspace) => workspace.id === firstId)?.archived).toBe(true)
    expect(listWorkspaces(target)).toHaveLength(2)
  })

  it('numbers duplicate names cleanly and permanently deletes only archived workspaces', () => {
    const target = directory('copies')
    const original = createWorkspace(target, 'Untitled pipeline', { projectTitle: 'Untitled pipeline' })
    const originalId = original.activeWorkspaceId!
    const firstCopy = duplicateWorkspace(target, originalId)
    expect(firstCopy.activeWorkspace?.name).toBe('Untitled pipeline copy')
    const secondCopy = duplicateWorkspace(target, firstCopy.activeWorkspaceId!)
    expect(secondCopy.activeWorkspace?.name).toBe('Untitled pipeline copy 2')
    expect(() => deleteWorkspace(target, originalId)).toThrow('Only an archived workspace')
    archiveWorkspace(target, originalId)
    const afterDelete = deleteWorkspace(target, originalId)
    expect(afterDelete.workspaces.map((workspace) => workspace.name).sort()).toEqual(['Untitled pipeline copy', 'Untitled pipeline copy 2'])
  })

  it('purges incident history when its archived workspace is permanently deleted', () => {
    const target = directory('delete-incidents')
    const workspace = createWorkspace(target, 'Disposable monitor', { projectTitle: 'Disposable monitor' })
    const workspaceId = workspace.activeWorkspaceId!
    recordIncidentEvent(target, {
      incidentKey: 'connector:orders',
      transition: 'opened',
      severity: 'warning',
      title: 'Orders unavailable',
      detail: 'Connector read failed.',
      sourceSystem: 'Kafka',
      sourceRef: 'topic:orders',
    })
    expect(listIncidentEvents(target)).toHaveLength(1)
    archiveWorkspace(target, workspaceId)
    deleteWorkspace(target, workspaceId)
    expect(listIncidentEvents(target)).toEqual([])
  })

  it('clears incident reports only for the active workspace', () => {
    const target = directory('clear-incidents')
    const first = createWorkspace(target, 'Orders monitor', { projectTitle: 'Orders monitor' })
    recordIncidentEvent(target, {
      incidentKey: 'orders',
      transition: 'opened',
      severity: 'warning',
      title: 'Orders drift',
      detail: 'Schema changed.',
    })
    createWorkspace(target, 'Customers monitor', { projectTitle: 'Customers monitor' })
    recordIncidentEvent(target, {
      incidentKey: 'customers',
      transition: 'opened',
      severity: 'critical',
      title: 'Customers unavailable',
      detail: 'Connector failed.',
    })

    expect(clearIncidentEvents(target)).toMatchObject({ deleted: 1 })
    expect(listIncidentEvents(target)).toEqual([])
    openWorkspace(target, first.activeWorkspaceId!)
    expect(listIncidentEvents(target)).toHaveLength(1)
    expect(listIncidentEvents(target)[0]?.incidentKey).toBe('orders')
  })

  it('keeps debounced drafts separate and offers recovery only after an unclean shutdown', () => {
    const target = directory('recovery')
    createWorkspace(target, 'Orders', { projectTitle: 'Orders', nodes: [{ id: 'baseline' }], versions: [] })
    expect(beginWorkspaceSession(target)).toBe(false)
    const draft = { projectTitle: 'Orders', nodes: [{ id: 'baseline' }], versions: [{ id: 'pending', status: 'pending-review', proposedNodes: [{ id: 'agent-proposal' }] }] }
    expect(autosaveWorkspaceDraft(target, draft).saved).toBe(true)
    expect(loadSavedWorkspace(target)).toEqual({ projectTitle: 'Orders', nodes: [{ id: 'baseline' }], versions: [] })

    closeWorkspaceDatabase()
    expect(beginWorkspaceSession(target)).toBe(true)
    const crashed = loadWorkspaceManagerState(target, true)
    expect(crashed.activeWorkspace?.payload).toEqual({ projectTitle: 'Orders', nodes: [{ id: 'baseline' }], versions: [] })
    expect(crashed.recovery?.payload).toEqual(draft)
    expect(crashed.activeWorkspace?.dirty).toBe(true)

    const recovered = resolveWorkspaceRecovery(target, 'recover')
    expect(recovered.activeWorkspace?.payload).toEqual(draft)
    expect(recovered.recovery).toBeUndefined()
    expect(recovered.activeWorkspace?.dirty).toBe(false)
  })

  it('can discard a crash draft and promotes autosaves on a clean shutdown', () => {
    const target = directory('clean')
    createWorkspace(target, 'Baseline', { value: 1 })
    beginWorkspaceSession(target)
    autosaveWorkspaceDraft(target, { value: 2 })
    expect(resolveWorkspaceRecovery(target, 'discard').activeWorkspace?.payload).toEqual({ value: 1 })

    autosaveWorkspaceDraft(target, { value: 3 })
    markWorkspaceSessionClean(target)
    closeWorkspaceDatabase()
    expect(beginWorkspaceSession(target)).toBe(false)
    expect(loadWorkspaceManagerState(target).activeWorkspace?.payload).toEqual({ value: 3 })
  })

  it('commits an autosaved draft before explicitly switching workspaces', () => {
    const target = directory('switch')
    const first = createWorkspace(target, 'First', { value: 'baseline' })
    const firstId = first.activeWorkspaceId!
    autosaveWorkspaceDraft(target, { value: 'autosaved before switch' })
    const second = createWorkspace(target, 'Second', { value: 'second' })

    openWorkspace(target, firstId)
    expect(loadWorkspaceManagerState(target).activeWorkspace?.payload).toEqual({ value: 'autosaved before switch' })
    expect(second.workspaces.find((workspace) => workspace.id === firstId)?.dirty).toBe(false)
  })

  it('supports explicit commits and preserves application settings independently', () => {
    const target = directory('settings')
    saveAppSetting(target, 'active-ai-provider', 'anthropic')
    expect(saveWorkspace(target, { projectTitle: 'Independent graph' })).toEqual({ saved: true })
    autosaveWorkspaceDraft(target, { projectTitle: 'Draft graph' })
    commitActiveWorkspace(target, { projectTitle: 'Committed graph' })
    closeWorkspaceDatabase()

    expect(loadAppSetting(target, 'active-ai-provider')).toBe('anthropic')
    expect(loadSavedWorkspace(target)).toEqual({ projectTitle: 'Committed graph' })
  })

  it('stores a bounded incident lifecycle in the active workspace and suppresses duplicate noise', () => {
    const target = directory('incidents')
    createWorkspace(target, 'Monitored graph', { projectTitle: 'Monitored graph' })
    const opened = recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'opened',
      severity: 'warning',
      title: 'Customer evidence unavailable',
      detail: 'get_entities timed out',
      sourceSystem: 'DataHub',
      sourceRef: 'urn:li:dataset:customers',
      fingerprint: 'warning-v1',
      cardId: 'customers-source',
    })
    expect(opened.recorded).toBe(true)
    expect(recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'opened',
      severity: 'warning',
      title: 'Customer evidence unavailable',
      detail: 'same timeout',
      fingerprint: 'warning-v1',
    }).recorded).toBe(false)
    const worsened = recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'opened',
      severity: 'critical',
      title: 'Customer evidence unavailable',
      detail: 'all metadata reads timed out',
      fingerprint: 'critical-v1',
    })
    expect(worsened.event).toMatchObject({
      transition: 'worsened',
      sourceSystem: 'DataHub',
      sourceRef: 'urn:li:dataset:customers',
    })
    const recovered = recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'recovered',
      severity: 'info',
      title: 'Customer evidence available',
      detail: 'all required metadata reads returned',
      fingerprint: 'healthy-v1',
    })
    expect(recovered).toMatchObject({
      recorded: true,
      event: { sourceSystem: 'DataHub', sourceRef: 'urn:li:dataset:customers' },
    })
    expect(recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'recovered',
      severity: 'info',
      title: 'Customer evidence available',
      detail: 'still healthy',
      fingerprint: 'healthy-v1',
    }).recorded).toBe(false)
    const reopened = recordIncidentEvent(target, {
      incidentKey: 'datahub-evidence:customers',
      transition: 'opened',
      severity: 'warning',
      title: 'Customer evidence unavailable again',
      detail: 'a later monitored fingerprint failed',
      fingerprint: 'warning-v2',
    })
    expect(reopened).toMatchObject({
      recorded: true,
      event: { sourceSystem: 'DataHub', sourceRef: 'urn:li:dataset:customers' },
    })

    expect(listIncidentEvents(target).map((event) => event.transition)).toEqual(['opened', 'recovered', 'worsened', 'opened'])
    expect(listIncidentEvents(target)[0].fingerprint).toBe('warning-v2')
    expect(listIncidentEvents(target).at(-1)).toMatchObject({ sourceSystem: 'DataHub', sourceRef: 'urn:li:dataset:customers' })
  })

  it('recovers provenance past legacy lifecycle rows that already stored null values', () => {
    const target = directory('legacy-null-provenance')
    const workspace = createWorkspace(target, 'Legacy incident', { projectTitle: 'Legacy incident' })
    recordIncidentEvent(target, {
      incidentKey: 'connector:orders',
      transition: 'opened',
      severity: 'warning',
      title: 'Orders drift',
      detail: 'Initial monitored drift.',
      sourceSystem: 'Kafka',
      sourceRef: 'topic:orders',
      fingerprint: 'orders-v1',
    })
    closeWorkspaceDatabase()

    const legacy = new DatabaseSync(join(target, 'sam-lab.sqlite'))
    legacy.prepare(`
      INSERT INTO incident_events (id, workspace_id, incident_key, transition, severity, title, detail, source_system, source_ref, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run('legacy-null-row', workspace.activeWorkspaceId, 'connector:orders', 'human-review', 'warning', 'Legacy review', 'Written by the previous release.', 'orders-v2', new Date(Date.now() + 1_000).toISOString())
    legacy.close()

    const repaired = recordIncidentEvent(target, {
      incidentKey: 'connector:orders',
      transition: 'agent-action',
      severity: 'warning',
      title: 'Repair proposed',
      detail: 'Continue the incident lifecycle.',
      fingerprint: 'orders-v3',
    })

    expect(repaired.event).toMatchObject({
      sourceSystem: 'Kafka',
      sourceRef: 'topic:orders',
    })
  })
})
