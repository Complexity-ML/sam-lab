// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataProfileSnapshot } from '../domain/data-profile'
import type { DataHubAssetSummary } from '../domain/datahub'
import { newCard } from '../domain/pipeline'

const { updateNodeInternals } = vi.hoisted(() => ({ updateNodeInternals: vi.fn() }))

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => <i data-handle-id={id ?? 'default'} data-testid="pipeline-handle" data-type={type} />,
  Position: { Left: 'left', Right: 'right' },
  useUpdateNodeInternals: () => updateNodeInternals,
}))

import { PipelineCard } from './PipelineCard'

afterEach(cleanup)

const cardProps = (card: ReturnType<typeof newCard>) => ({
  id: card.id,
  data: card.data,
  selected: false,
}) as unknown as Parameters<typeof PipelineCard>[0]

describe('Pipeline card ports', () => {
  it('lets Data Profile participate in a replayable graph path', () => {
    const profile = newCard('profile', 0)
    render(<PipelineCard {...cardProps(profile)} />)
    expect(screen.getAllByTestId('pipeline-handle').map((handle) => handle.getAttribute('data-type'))).toEqual(['target', 'source'])
  })

  it('shows bounded aggregate dataset evidence without exposing raw rows', () => {
    const asset: DataHubAssetSummary = {
      urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.metrics,PROD)',
      name: 'metrics',
      platform: 'snowflake',
      environment: 'PROD',
      description: 'Metrics',
      owners: ['Data'],
      domain: 'ML',
      tags: [],
      qualityStatus: 'healthy',
      upstream: [],
      downstream: [],
      fields: [{ name: 'score', type: 'number' }],
      freshness: { capturedAt: '2026-07-24T10:00:00.000Z', expiresAt: '2099-07-24T11:00:00.000Z', stale: false },
      dataProfile: {
        status: 'available',
        capturedAt: '2026-07-24T10:00:00.000Z',
        rowCount: 700,
        fields: [{ name: 'score', nullRate: 0.2 }],
        risks: [{ id: 'null-spike', kind: 'null_spike', severity: 'high', field: 'score', summary: 'Null spike.' }],
      },
    }
    const base = newCard('profile', 0)
    const profile = { ...base, data: { ...base.data, profile: createDataProfileSnapshot(asset) } }

    render(<PipelineCard {...cardProps(profile)} />)

    const summary = screen.getByLabelText('Compact data profile')
    expect(summary.textContent).toContain('700 rows')
    expect(summary.textContent).toContain('1 profiled')
    expect(summary.textContent).toContain('1 value risks')
    expect(summary.textContent).toContain('raw rows excluded')
  })

  it('renders the structured risk context without losing normal graph ports', () => {
    const risk = newCard('risk', 0)
    render(<PipelineCard {...cardProps(risk)} />)
    expect(screen.getByText('general · unknown')).toBeTruthy()
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getAllByTestId('pipeline-handle').map((handle) => handle.getAttribute('data-type'))).toEqual(['target', 'source'])
  })

  it('exposes only a feedback source on Output for a next monitor iteration', () => {
    const output = newCard('output', 0)
    render(<PipelineCard {...cardProps(output)} />)
    const handles = screen.getAllByTestId('pipeline-handle')
    expect(handles.map((handle) => [handle.getAttribute('data-type'), handle.getAttribute('data-handle-id')])).toEqual([
      ['target', 'default'],
      ['source', 'feedback'],
    ])
  })

  it('keeps the global SAM LAB Controller outside dataset lineage', () => {
    const controller = newCard('control', 0)
    render(<PipelineCard {...cardProps(controller)} />)
    expect(screen.queryAllByTestId('pipeline-handle')).toEqual([])
    expect(screen.getByText('Player')).toBeTruthy()
  })

  it('refreshes React Flow handle geometry when a card role changes', () => {
    const analysis = newCard('analysis', 0)
    const split = newCard('split', 0)
    const view = render(<PipelineCard {...cardProps(analysis)} />)

    view.rerender(<PipelineCard {...cardProps({ ...split, id: analysis.id })} />)

    expect(updateNodeInternals).toHaveBeenLastCalledWith(analysis.id)
    expect(screen.getAllByTestId('pipeline-handle').map((handle) => handle.getAttribute('data-handle-id'))).toEqual(['default', 'approved', 'quarantine'])
  })
})
