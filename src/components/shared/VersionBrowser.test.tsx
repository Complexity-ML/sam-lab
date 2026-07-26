// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VersionBrowser, type VersionSummary } from './VersionBrowser'

const versions: VersionSummary[] = [
  { id: 'rejected-1', label: 'Rejected broad rewrite', createdAt: '2026-07-22T20:00:00.000Z', origin: 'agent', blockingIssues: 0, status: 'rejected', description: 'Too broad; active graph unchanged.' },
  { id: 'pending-1', label: 'Review masking upgrade', createdAt: '2026-07-22T21:00:00.000Z', origin: 'agent', blockingIssues: 0, status: 'pending-review', description: 'Mask email before activation.' },
]

afterEach(cleanup)

describe('Human Review inbox', () => {
  it('lists pending reviews with pipeline, reason and timestamp while keeping resolved history visible', () => {
    const approve = vi.fn()
    const reject = vi.fn()
    const stop = vi.fn()
    const remind = vi.fn()
    render(<VersionBrowser onApprove={approve} onEmergencyStop={stop} onReject={reject} onRemind={remind} onRestore={vi.fn()} pipelineTitle="Customer activation" versions={versions} />)

    expect(screen.getByText('1 pending · Customer activation')).toBeTruthy()
    expect(screen.getAllByText('Mask email before activation.', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('Rejected broad rewrite')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remind' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(remind).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-1' }))
    expect(stop).toHaveBeenCalledOnce()
    expect(reject).toHaveBeenCalledWith('pending-1')
    expect(approve).toHaveBeenCalledWith('pending-1')
  })
})
