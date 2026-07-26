import { Command, X } from 'lucide-react'
import { Modal } from './Modal'

const shortcuts = [
  ['⌘/Ctrl + S', 'Save the current workspace'],
  ['⌘/Ctrl + Z', 'Undo the last graph change'],
  ['⌘/Ctrl + Shift + Z', 'Redo the graph change'],
  ['A', 'Add an Asset Source card'],
  ['Delete / Backspace', 'Delete the selected card'],
  ['F', 'Fit the graph in the canvas'],
  ['⌥/Alt + 1…4', 'Focus library, canvas, inspector or agent composer'],
  ['?', 'Open this shortcut reference'],
]

export function KeyboardShortcutsModal({ onClose }: { onClose(): void }) {
  return <Modal ariaLabelledby="keyboard-shortcuts-title" className="keyboard-shortcuts-modal" onClose={onClose}>
    <header><span><Command size={18} /></span><div><small>ACCESSIBILITY</small><h2 id="keyboard-shortcuts-title">Keyboard shortcuts</h2><p>Navigate and edit the workbench without a mouse.</p></div><button aria-label="Close keyboard shortcuts" onClick={onClose} type="button"><X size={17} /></button></header>
    <dl>{shortcuts.map(([keys, action]) => <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>)}</dl>
  </Modal>
}
