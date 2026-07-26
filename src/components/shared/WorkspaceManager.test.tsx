// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceManager } from './WorkspaceManager'

afterEach(cleanup)

const actions = () => ({ onArchive: vi.fn(async () => undefined), onCreate: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined), onDuplicate: vi.fn(async () => undefined), onOpen: vi.fn(async () => undefined), onRename: vi.fn(async () => undefined), onSave: vi.fn(async () => undefined) })

describe('WorkspaceManager', () => {
  it('keeps a blank workbench unsaved until the user creates a workspace', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    render(<WorkspaceManager activeWorkspaceId={null} {...handlers} projectTitle="Untitled pipeline" saveState="unsaved" workspaces={[]} />)

    expect(screen.getByText('No saved workspace yet')).toBeTruthy()
    await user.clear(screen.getByRole('textbox', { name: 'New workspace name' }))
    await user.type(screen.getByRole('textbox', { name: 'New workspace name' }), 'Governed orders')
    await user.click(screen.getByRole('button', { name: 'Create from workbench' }))
    expect(handlers.onCreate).toHaveBeenCalledWith('Governed orders')
  })

  it('requires an explicit second click before permanently deleting an archived workspace', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    const archived = { id: 'archived', name: 'Old graph', archived: true, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }
    render(<WorkspaceManager activeWorkspaceId={null} {...handlers} projectTitle="Blank" saveState="unsaved" workspaces={[archived]} />)

    await user.click(screen.getByRole('button', { name: 'Delete Old graph' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete Old graph' }))
    expect(handlers.onDelete).toHaveBeenCalledWith('archived')
  })

  it('exposes rename, save, switch, duplicate and archive actions', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    const workspaces = [
      { id: 'a', name: 'Active', archived: false, dirty: true, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:01:00.000Z' },
      { id: 'b', name: 'Other', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' },
    ]
    render(<WorkspaceManager activeWorkspaceId="a" {...handlers} projectTitle="Active" saveState="saved" workspaces={workspaces} />)

    await user.clear(screen.getByRole('textbox', { name: 'Workspace name' }))
    await user.type(screen.getByRole('textbox', { name: 'Workspace name' }), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save now' }))
    await user.click(screen.getByRole('button', { name: /OtherSaved/ }))
    await user.click(screen.getByRole('button', { name: 'Duplicate Active' }))
    await user.click(screen.getByRole('button', { name: 'Archive Active' }))

    expect(handlers.onRename).toHaveBeenCalledWith('a', 'Renamed')
    expect(handlers.onSave).toHaveBeenCalled()
    expect(handlers.onOpen).toHaveBeenCalledWith('b')
    expect(handlers.onDuplicate).toHaveBeenCalledWith('a')
    expect(handlers.onArchive).toHaveBeenCalledWith('a')
  })
})
