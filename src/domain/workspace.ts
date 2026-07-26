import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'
import type { PipelineVersion } from './versioning'

export interface WorkspacePayload {
  projectTitle: string
  nodes: PipelineNode[]
  edges: Edge[]
  versions: PipelineVersion[]
  projectSettings?: {
    inspectorOpen: boolean
    libraryOpen: boolean
  }
}

export interface WorkspaceSummary {
  id: string
  name: string
  archived: boolean
  dirty: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkspaceRecord extends WorkspaceSummary {
  payload: WorkspacePayload
}

export interface WorkspaceManagerState {
  activeWorkspace?: WorkspaceRecord
  activeWorkspaceId: string | null
  recovery?: { payload: WorkspacePayload; updatedAt: string }
  uncleanShutdown: boolean
  workspaces: WorkspaceSummary[]
}

export type WorkspaceSaveState = 'saved' | 'unsaved' | 'recovering'

export function isWorkspacePayload(value: unknown): value is WorkspacePayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkspacePayload>
  return typeof candidate.projectTitle === 'string'
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.edges)
    && Array.isArray(candidate.versions)
}
