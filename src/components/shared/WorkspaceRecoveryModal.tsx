import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { ActionButton } from './ActionButton'
import { Modal } from './Modal'

interface WorkspaceRecoveryModalProps {
  onDiscard(): void
  onRecover(): void
  updatedAt: string
}

export function WorkspaceRecoveryModal({ onDiscard, onRecover, updatedAt }: WorkspaceRecoveryModalProps) {
  return <Modal ariaLabelledby="workspace-recovery-title" className="workspace-recovery-modal" onClose={() => undefined}>
    <div className="workspace-recovery-icon"><AlertTriangle size={24} /></div>
    <div>
      <small>INTERRUPTED SESSION</small>
      <h2 id="workspace-recovery-title">Recover your autosaved work?</h2>
      <p>SAM LAB found a local draft from {new Date(updatedAt).toLocaleString()}. The last committed graph remains intact until you choose.</p>
    </div>
    <div className="workspace-recovery-actions">
      <ActionButton icon={<Trash2 size={15} />} onClick={onDiscard}>Discard draft</ActionButton>
      <ActionButton icon={<RotateCcw size={15} />} onClick={onRecover} variant="primary">Recover draft</ActionButton>
    </div>
  </Modal>
}
