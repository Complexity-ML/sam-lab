import type { Edge } from '@xyflow/react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PipelineNode } from '../domain/pipeline'
import type { PipelineVersion } from '../domain/versioning'
import { isWorkspacePayload, type WorkspaceManagerState, type WorkspacePayload, type WorkspaceSaveState } from '../domain/workspace'
import { notifyError } from '../domain/toasts'
import { recordDiagnostic } from '../domain/diagnostics'

interface WorkspacePersistenceOptions {
  edges: Edge[]
  inspectorOpen: boolean
  libraryOpen: boolean
  nodes: PipelineNode[]
  projectTitle: string
  setActivity(message: string): void
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setInspectorOpen: Dispatch<SetStateAction<boolean>>
  setLibraryOpen: Dispatch<SetStateAction<boolean>>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setProjectTitle: Dispatch<SetStateAction<string>>
  setSelectedId: Dispatch<SetStateAction<string>>
  setVersions: Dispatch<SetStateAction<PipelineVersion[]>>
  versions: PipelineVersion[]
}

const emptyManager: WorkspaceManagerState = { activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] }

export function useWorkspacePersistence(options: WorkspacePersistenceOptions) {
  const { edges, inspectorOpen, libraryOpen, nodes, projectTitle, setActivity, setEdges, setInspectorOpen, setLibraryOpen, setNodes, setProjectTitle, setSelectedId, setVersions, versions } = options
  const [manager, setManager] = useState<WorkspaceManagerState>(emptyManager)
  const [saveState, setSaveState] = useState<WorkspaceSaveState>('unsaved')
  const [ready, setReady] = useState(false)
  const persistenceEnabled = useRef(false)
  const lastSnapshot = useRef('')
  const latestSnapshot = useRef('')
  const payload: WorkspacePayload = { projectTitle, nodes, edges, versions, projectSettings: { inspectorOpen, libraryOpen } }

  const applyPayload = (workspace: WorkspacePayload) => {
    const normalized = { ...workspace, projectSettings: workspace.projectSettings ?? { inspectorOpen, libraryOpen } }
    const serialized = JSON.stringify(normalized)
    lastSnapshot.current = serialized
    latestSnapshot.current = serialized
    setNodes(normalized.nodes)
    setEdges(normalized.edges)
    setVersions(normalized.versions)
    setProjectTitle(normalized.projectTitle)
    setSelectedId(normalized.nodes[0]?.id ?? '')
    setInspectorOpen(normalized.projectSettings.inspectorOpen)
    setLibraryOpen(normalized.projectSettings.libraryOpen)
  }

  const applyManagerState = (state: WorkspaceManagerState, activity?: string) => {
    setManager(state)
    const activePayload = state.activeWorkspace?.payload
    if (activePayload && isWorkspacePayload(activePayload)) {
      applyPayload(activePayload)
      persistenceEnabled.current = true
      setSaveState(state.recovery ? 'recovering' : 'saved')
    } else {
      persistenceEnabled.current = false
      setSaveState('unsaved')
      if (state.activeWorkspace) setActivity('Saved workspace is invalid · blank workbench preserved')
    }
    if (activity) setActivity(activity)
  }

  useEffect(() => {
    if (!window.dataLab) { setReady(true); return }
    let active = true
    void window.dataLab.loadWorkspaceState().then((state) => {
      if (!active) return
      applyManagerState(state, state.activeWorkspace
        ? `SQLite workspace restored · ${state.activeWorkspace.name} · ${state.activeWorkspace.payload.nodes.length} cards`
        : 'Blank workbench ready · create a workspace when you want to persist it')
      setReady(true)
    }).catch((error) => {
      if (!active) return
      notifyError(error, 'SQLite workspace restore failed')
      setActivity(`Workspace restore failed · ${error instanceof Error ? error.message : 'SQLite unavailable'}`)
      setReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!ready || !window.dataLab || !persistenceEnabled.current || saveState === 'recovering') return
    const serialized = JSON.stringify(payload)
    latestSnapshot.current = serialized
    if (serialized === lastSnapshot.current) return
    setSaveState('unsaved')
    const timer = window.setTimeout(() => {
      void window.dataLab?.autosaveWorkspace(payload).then((result) => {
        if (!result.saved) return
        lastSnapshot.current = serialized
        if (latestSnapshot.current === serialized) setSaveState('saved')
        recordDiagnostic({ category: 'workspace', action: 'draft.autosave', status: 'success', detail: { workspaceId: result.workspaceId } })
        setManager((current) => ({
          ...current,
          activeWorkspace: current.activeWorkspace ? { ...current.activeWorkspace, dirty: true, payload } : current.activeWorkspace,
          workspaces: current.workspaces.map((workspace) => workspace.id === result.workspaceId ? { ...workspace, dirty: true, updatedAt: result.updatedAt } : workspace),
        }))
      }).catch((error) => {
        notifyError(error, 'SQLite autosave failed')
        setSaveState('unsaved')
        setActivity(`Autosave failed · ${error instanceof Error ? error.message : 'SQLite unavailable'}`)
      })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [edges, inspectorOpen, libraryOpen, nodes, projectTitle, ready, saveState, versions])

  const create = async (name: string, workspace = payload) => {
    if (!window.dataLab) throw new Error('Workspace persistence requires the Electron application')
    const state = await window.dataLab.createWorkspace(name, workspace)
    applyManagerState(state, `Workspace created · ${state.activeWorkspace?.name ?? name}`)
  }

  const rename = async (workspaceId: string, name: string) => {
    if (!window.dataLab) return
    const workspaces = await window.dataLab.renameWorkspace(workspaceId, name)
    setManager((current) => ({
      ...current,
      activeWorkspace: current.activeWorkspace?.id === workspaceId ? { ...current.activeWorkspace, name: name.trim() } : current.activeWorkspace,
      workspaces,
    }))
    setActivity(`Workspace renamed · ${name.trim()}`)
  }

  const duplicate = async (workspaceId: string) => {
    if (!window.dataLab) return
    const state = await window.dataLab.duplicateWorkspace(workspaceId)
    applyManagerState(state, `Workspace duplicated · ${state.activeWorkspace?.name ?? 'copy'}`)
  }

  const archive = async (workspaceId: string) => {
    if (!window.dataLab) return
    const state = await window.dataLab.archiveWorkspace(workspaceId)
    if (state.activeWorkspace?.payload && isWorkspacePayload(state.activeWorkspace.payload)) {
      applyManagerState(state, `Workspace archived · opened ${state.activeWorkspace.name}`)
      return
    }
    setManager(state)
    persistenceEnabled.current = false
    setSaveState('unsaved')
    applyPayload({ projectTitle: 'Untitled pipeline', nodes: [], edges: [], versions: [], projectSettings: { inspectorOpen: true, libraryOpen: true } })
    setActivity('Workspace archived · blank workbench ready')
  }

  const remove = async (workspaceId: string) => {
    if (!window.dataLab) return
    const state = await window.dataLab.deleteWorkspace(workspaceId)
    setManager(state)
    setActivity('Archived workspace deleted permanently')
    recordDiagnostic({ category: 'workspace', action: 'workspace.delete', status: 'info', detail: { workspaceId } })
  }

  const open = async (workspaceId: string) => {
    if (!window.dataLab) return
    const state = await window.dataLab.openWorkspace(workspaceId)
    applyManagerState(state, `Workspace opened · ${state.activeWorkspace?.name ?? 'workspace'}`)
  }

  const save = async () => {
    if (!window.dataLab) return
    if (!persistenceEnabled.current || !manager.activeWorkspaceId) {
      await create(projectTitle, payload)
      return
    }
    const result = await window.dataLab.commitWorkspace(payload)
    lastSnapshot.current = JSON.stringify(payload)
    setSaveState('saved')
    setManager((current) => ({
      ...current,
      activeWorkspace: current.activeWorkspace ? { ...current.activeWorkspace, dirty: false, payload, updatedAt: result.updatedAt } : current.activeWorkspace,
      workspaces: current.workspaces.map((workspace) => workspace.id === result.workspaceId ? { ...workspace, dirty: false, updatedAt: result.updatedAt } : workspace),
    }))
    setActivity('Workspace saved · validated graph and pending revisions persisted separately')
  }

  const persistImported = async (workspace: WorkspacePayload) => {
    if (!window.dataLab) return
    if (!persistenceEnabled.current || !manager.activeWorkspaceId) await create(workspace.projectTitle, workspace)
    else {
      applyPayload(workspace)
      await window.dataLab.commitWorkspace(workspace)
      lastSnapshot.current = JSON.stringify(workspace)
      setSaveState('saved')
    }
  }

  const detach = () => {
    persistenceEnabled.current = false
    lastSnapshot.current = ''
    setSaveState('unsaved')
  }

  const resolveRecovery = async (action: 'recover' | 'discard') => {
    if (!window.dataLab) return
    const state = await window.dataLab.resolveWorkspaceRecovery(action)
    applyManagerState(state, action === 'recover' ? 'Recovered autosaved draft after the interrupted session' : 'Discarded interrupted draft · restored last committed workspace')
    recordDiagnostic({ category: 'workspace', action: `recovery.${action}`, status: action === 'recover' ? 'success' : 'info', detail: { workspaceId: state.activeWorkspaceId } })
  }

  return {
    activeWorkspaceId: manager.activeWorkspaceId,
    archiveWorkspace: archive,
    createWorkspace: create,
    deleteWorkspace: remove,
    detachWorkspace: detach,
    duplicateWorkspace: duplicate,
    openWorkspace: open,
    persistImportedWorkspace: persistImported,
    recovery: manager.recovery,
    renameWorkspace: rename,
    resolveRecovery,
    saveState,
    saveWorkspace: save,
    workspaces: manager.workspaces,
  }
}
