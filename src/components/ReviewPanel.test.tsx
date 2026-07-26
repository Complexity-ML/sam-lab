// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProposal } from '../domain/pipeline'
import { ReviewPanel } from './ReviewPanel'

const proposal: AgentProposal = {
  id: 'proposal-1',
  title: 'Correct customer schema',
  summary: 'Align the customer identifier with the catalog contract.',
  rationale: 'DataHub identifies customer_id as the governed primary identifier.',
  writeback: 'Commit the reviewed graph revision locally.',
  requiresHumanReview: true,
  datahubReads: ['get_entities · ok'],
  addedNodes: [],
  updatedNodes: [],
  removedEdgeIds: [],
  addedEdges: [],
}

afterEach(cleanup)

describe('governed DataHub write-back review', () => {
  it('keeps external write-back unavailable and unselected by default', () => {
    const apply = vi.fn()
    render(<ReviewPanel proposal={proposal} relatedAssets={[]} revisionId="revision-1" writebackAvailable={false} onApply={apply} onClose={vi.fn()} onDiscard={vi.fn()} />)

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Disabled by default.', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve change' }))
    expect(apply).toHaveBeenCalledWith(false)
  })

  it('shows the exact mutation and requires an explicit checkbox before approval', () => {
    const apply = vi.fn()
    render(<ReviewPanel
      proposal={proposal}
      relatedAssets={['urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)']}
      revisionId="revision-42"
      writebackAvailable
      onApply={apply}
      onClose={vi.fn()}
      onDiscard={vi.fn()}
    />)

    expect(screen.queryByLabelText('DataHub mutation preview')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Also publish this approved Decision to DataHub/ }))
    const preview = screen.getByLabelText('DataHub mutation preview')
    expect(preview.textContent).toContain('Governed DataHub Decision write-back')
    expect(preview.textContent).toContain('Decision')
    expect(preview.textContent).toContain('revision-42')
    expect(preview.textContent).toContain(proposal.rationale)
    fireEvent.click(screen.getByRole('button', { name: 'Approve change' }))
    expect(apply).toHaveBeenCalledWith(true)
  })
})
