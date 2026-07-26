export type AgentProposalMemoryStatus = 'generated' | 'pending-review' | 'committed' | 'rejected' | 'invalid' | 'duplicate'
export type AgentProposalMemorySource = 'pipeline' | 'card-rework'

export interface AgentProposalMemoryEntry {
  id: string
  scopeId: string
  graphFingerprint: string
  baseGraphFingerprint: string
  status: AgentProposalMemoryStatus
  source: AgentProposalMemorySource
  title: string
  summary: string
  rationale: string
  occurrenceCount: number
  firstSeenAt: string
  lastSeenAt: string
  decidedAt?: string
  versionId?: string
}

export interface RememberAgentProposalInput {
  graphFingerprint: string
  baseGraphFingerprint: string
  source: AgentProposalMemorySource
  title: string
  summary: string
  rationale: string
}
