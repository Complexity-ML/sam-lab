import type { AgentProposal } from '../domain/pipeline'
import { ReviewPanel } from './ReviewPanel'
import { Modal } from './shared/Modal'

interface ProposalReviewModalProps {
  assistant?: import('./ReviewPanel').ReviewAssistantProps
  applying?: boolean
  proposal: AgentProposal
  relatedAssets: string[]
  revisionId?: string
  writebackAvailable: boolean
  onApply(writebackRequested: boolean): void
  onClose(): void
  onDiscard(): void
}

export function ProposalReviewModal(props: ProposalReviewModalProps) {
  return <Modal ariaLabelledby="proposal-review-title" className="proposal-review-modal" onClose={props.onClose}>
    <ReviewPanel {...props} />
  </Modal>
}
