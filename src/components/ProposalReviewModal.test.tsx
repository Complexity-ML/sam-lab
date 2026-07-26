// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProposal } from '../domain/pipeline'
import { ProposalReviewModal } from './ProposalReviewModal'

const proposal: AgentProposal = {
  id: 'proposal-modal-1',
  title: 'Validate the proposed graph',
  summary: 'Review the evidence-backed graph before applying it.',
  rationale: 'The active graph remains unchanged until explicit approval.',
  writeback: 'Commit the reviewed graph locally.',
  requiresHumanReview: true,
  datahubReads: ['get_entities · ok'],
  addedNodes: [],
  updatedNodes: [],
  removedEdgeIds: [],
  addedEdges: [],
}

afterEach(cleanup)

describe('proposal graph validation modal', () => {
  it('opens as a labelled dialog and closes without rejecting the proposal', () => {
    const close = vi.fn()
    const discard = vi.fn()
    render(<ProposalReviewModal proposal={proposal} relatedAssets={[]} revisionId="revision-1" writebackAvailable={false} onApply={vi.fn()} onClose={close} onDiscard={discard} />)

    expect(screen.getByRole('dialog', { name: proposal.title })).toBeTruthy()
    expect(screen.getByText('Proposed graph diff')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close proposal review' }))
    expect(close).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
  })

  it('keeps the review prompt inside the modal and delegates only a question', () => {
    const ask = vi.fn()
    render(<ProposalReviewModal
      assistant={{
        activity: 'Waiting for a reviewer question',
        answer: { summary: 'Approval may affect one downstream model.', rationale: 'Lineage is fresh but ownership is missing.', evidence: ['get_lineage · ok'], model: 'gpt-5.6-sol' },
        busy: false,
        connected: true,
        context: { cards: 2, edges: 1, versions: 1, mcp: 'MCP connected', model: 'ChatGPT · gpt-5.6-sol' },
        onAsk: ask,
        onOpenSettings: vi.fn(),
        onStop: vi.fn(),
      }}
      proposal={proposal}
      relatedAssets={[]}
      revisionId="revision-1"
      writebackAvailable={false}
      onApply={vi.fn()}
      onClose={vi.fn()}
      onDiscard={vi.fn()}
    />)

    expect(screen.getByText('Read-only · cannot approve, reject, mutate or write back')).toBeTruthy()
    expect(screen.getByText('Approval may affect one downstream model.')).toBeTruthy()
    const prompt = screen.getByRole('textbox', { name: 'Ask the Human Review assistant' })
    fireEvent.change(prompt, { target: { value: 'What is the safest alternative?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask the Human Review assistant' }))
    expect(ask).toHaveBeenCalledWith('What is the safest alternative?')
  })
})
