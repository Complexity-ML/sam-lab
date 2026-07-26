import { Archive, Check, Copy, FolderOpen, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorkspaceSaveState, WorkspaceSummary } from '../../domain/workspace'
import { notifyError } from '../../domain/toasts'
import { ActionButton } from './ActionButton'

interface WorkspaceManagerProps {
  activeWorkspaceId: string | null
  onArchive(workspaceId: string): Promise<void>
  onCreate(name: string): Promise<void>
  onDelete(workspaceId: string): Promise<void>
  onDuplicate(workspaceId: string): Promise<void>
  onOpen(workspaceId: string): Promise<void>
  onRename(workspaceId: string, name: string): Promise<void>
  onSave(): Promise<void>
  projectTitle: string
  saveState: WorkspaceSaveState
  workspaces: WorkspaceSummary[]
}

export function WorkspaceManager(props: WorkspaceManagerProps) {
  const { activeWorkspaceId, onArchive, onCreate, onDelete, onDuplicate, onOpen, onRename, onSave, projectTitle, saveState, workspaces } = props
  const [name, setName] = useState(projectTitle)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<string>()
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId)

  useEffect(() => { setRenameValue(active?.name ?? '') }, [active?.id, active?.name])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFeedback('')
    try { await action() } catch (error) { notifyError(error, 'Workspace action failed'); setFeedback(error instanceof Error ? error.message : 'Workspace action failed.') } finally { setBusy(false) }
  }

  return <div className="workspace-manager">
    <section className="settings-section workspace-current">
      <div className="settings-section-title"><span>Current workbench</span><small className={`save-state ${saveState}`}>{saveState}</small></div>
      {active ? <>
        <div className="workspace-current-row">
          <label><span>Workspace name</span><input aria-label="Workspace name" maxLength={120} onChange={(event) => setRenameValue(event.target.value)} value={renameValue} /></label>
          <ActionButton disabled={busy || !renameValue.trim() || renameValue.trim() === active.name} icon={<Check size={15} />} onClick={() => void run(() => onRename(active.id, renameValue))}>Rename</ActionButton>
          <ActionButton disabled={busy} icon={<Save size={15} />} onClick={() => void run(onSave)} variant="primary">Save now</ActionButton>
        </div>
        <p className="workspace-help">Draft changes autosave locally after 650 ms. “Save now” promotes them to the committed workspace baseline.</p>
      </> : <>
        <div className="workspace-create-row">
          <label><span>New workspace name</span><input aria-label="New workspace name" maxLength={120} onChange={(event) => setName(event.target.value)} value={name} /></label>
          <ActionButton disabled={busy || !name.trim()} icon={<Plus size={15} />} onClick={() => void run(() => onCreate(name))} variant="primary">Create from workbench</ActionButton>
        </div>
        <p className="workspace-help">This blank or example workbench is not persisted until you explicitly create a workspace.</p>
      </>}
      {feedback && <p className="settings-feedback error" role="status">{feedback}</p>}
    </section>

    <section className="settings-section workspace-list-section">
      <div className="settings-section-title"><span>Saved workspaces</span><small>{workspaces.filter((workspace) => !workspace.archived).length} active · {workspaces.filter((workspace) => workspace.archived).length} archived</small></div>
      {workspaces.length === 0 ? <div className="workspace-empty"><FolderOpen size={21} /><strong>No saved workspace yet</strong><small>A new installation always starts with a blank workbench.</small></div> : <div className="workspace-list">
        {workspaces.map((workspace) => <article className={`${workspace.id === activeWorkspaceId ? 'is-active' : ''}${workspace.archived ? ' is-archived' : ''}`} key={workspace.id}>
          <button className="workspace-open" disabled={busy || workspace.archived || workspace.id === activeWorkspaceId} onClick={() => void run(() => onOpen(workspace.id))} type="button">
            <FolderOpen size={17} />
            <span><strong>{workspace.name}</strong><small>{workspace.archived ? 'Archived' : workspace.dirty ? 'Autosaved draft' : 'Saved'} · {new Date(workspace.updatedAt).toLocaleString()}</small></span>
          </button>
          <div className="workspace-row-actions">
            <button aria-label={`Duplicate ${workspace.name}`} disabled={busy} onClick={() => void run(() => onDuplicate(workspace.id))} title="Duplicate workspace" type="button"><Copy size={15} /></button>
            {!workspace.archived && <button aria-label={`Archive ${workspace.name}`} disabled={busy} onClick={() => void run(() => onArchive(workspace.id))} title="Archive workspace" type="button"><Archive size={15} /></button>}
            {workspace.archived && deleteCandidate !== workspace.id && <button aria-label={`Delete ${workspace.name}`} className="workspace-delete" disabled={busy} onClick={() => setDeleteCandidate(workspace.id)} title="Delete archived workspace permanently" type="button"><Trash2 size={15} /></button>}
            {workspace.archived && deleteCandidate === workspace.id && <div className="workspace-delete-confirm"><button aria-label={`Confirm delete ${workspace.name}`} className="workspace-delete" disabled={busy} onClick={() => void run(async () => { await onDelete(workspace.id); setDeleteCandidate(undefined) })} title="Confirm permanent deletion" type="button"><Trash2 size={14} /><span>Delete</span></button><button aria-label={`Cancel delete ${workspace.name}`} disabled={busy} onClick={() => setDeleteCandidate(undefined)} title="Cancel deletion" type="button"><X size={14} /></button></div>}
          </div>
        </article>)}
      </div>}
    </section>
  </div>
}
