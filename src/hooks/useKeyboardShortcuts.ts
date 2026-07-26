import { useEffect } from 'react'

interface KeyboardShortcutActions {
  add(): void
  deleteSelected(): void
  fitView(): void
  openHelp(): void
  redo(): void
  save(): void
  undo(): void
}

function focusRegion(id: string) {
  document.getElementById(id)?.focus()
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isEditing = target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 's') { event.preventDefault(); actions.save(); return }
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? actions.redo() : actions.undo(); return }
      if (isEditing) return
      if (event.altKey && event.key === '1') { event.preventDefault(); focusRegion('sam-lab-library'); return }
      if (event.altKey && event.key === '2') { event.preventDefault(); focusRegion('sam-lab-canvas'); return }
      if (event.altKey && event.key === '3') { event.preventDefault(); focusRegion('sam-lab-inspector'); return }
      if (event.altKey && event.key === '4') { event.preventDefault(); focusRegion('sam-lab-agent-prompt'); return }
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); actions.add(); return }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); actions.fitView(); return }
      if ((event.key === 'Backspace' || event.key === 'Delete')) { event.preventDefault(); actions.deleteSelected(); return }
      if (event.key === '?') { event.preventDefault(); actions.openHelp() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions])
}
