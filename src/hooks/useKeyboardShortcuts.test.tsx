// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

afterEach(cleanup)

function Harness({ actions }: { actions: Parameters<typeof useKeyboardShortcuts>[0] }) {
  useKeyboardShortcuts(actions)
  return <textarea aria-label="Editor" />
}

describe('workspace keyboard shortcuts', () => {
  it('dispatches save, undo, redo, add, delete, fit and help', () => {
    const actions = { add: vi.fn(), deleteSelected: vi.fn(), fitView: vi.fn(), openHelp: vi.fn(), redo: vi.fn(), save: vi.fn(), undo: vi.fn() }
    render(<Harness actions={actions} />)
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'Delete' })
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: '?' })
    expect(actions.save).toHaveBeenCalledOnce()
    expect(actions.undo).toHaveBeenCalledOnce()
    expect(actions.redo).toHaveBeenCalledOnce()
    expect(actions.add).toHaveBeenCalledOnce()
    expect(actions.deleteSelected).toHaveBeenCalledOnce()
    expect(actions.fitView).toHaveBeenCalledOnce()
    expect(actions.openHelp).toHaveBeenCalledOnce()
  })

  it('does not mutate the graph while typing in an editor', () => {
    const actions = { add: vi.fn(), deleteSelected: vi.fn(), fitView: vi.fn(), openHelp: vi.fn(), redo: vi.fn(), save: vi.fn(), undo: vi.fn() }
    const { getByRole } = render(<Harness actions={actions} />)
    fireEvent.keyDown(getByRole('textbox', { name: 'Editor' }), { key: 'a' })
    fireEvent.keyDown(getByRole('textbox', { name: 'Editor' }), { key: 'Delete' })
    expect(actions.add).not.toHaveBeenCalled()
    expect(actions.deleteSelected).not.toHaveBeenCalled()
  })
})
