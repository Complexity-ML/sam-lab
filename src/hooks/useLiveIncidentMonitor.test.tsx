// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DataHubMcpAudit } from '../electron-api'
import { newCard } from '../domain/pipeline'
import { useLiveIncidentMonitor } from './useLiveIncidentMonitor'

const audit: DataHubMcpAudit = {
  urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)',
  transport: 'stdio',
  reads: [{
    name: 'get_entities',
    status: 'error',
    summary: 'Metadata read failed',
    capturedAt: '2026-07-23T20:00:00.000Z',
    expiresAt: '2026-07-23T20:01:00.000Z',
    cached: false,
    stale: false,
  }],
}

describe('live incident monitor lifecycle', () => {
  it('drops a deferred trigger when the player becomes inactive', async () => {
    const source = {
      ...newCard('source', 0),
      id: 'source',
      data: { ...newCard('source', 0).data, datahubUrn: audit.urn },
    }
    const monitor = { ...newCard('monitor', 1), id: 'monitor' }
    const nodes = [source, monitor]
    const edges = [{ id: 'source-monitor', source: source.id, target: monitor.id }]
    const readAudit = vi.fn(async () => audit)
    const onIncident = vi.fn(async () => undefined)
    const onTrigger = vi.fn(async () => undefined)

    const { rerender } = renderHook(
      ({ active, blocked }) => useLiveIncidentMonitor({
        active,
        agentBlocked: blocked,
        nodes,
        edges,
        audit: readAudit,
        onIncident,
        onTrigger,
      }),
      { initialProps: { active: true, blocked: true } },
    )

    await waitFor(() => expect(onIncident).toHaveBeenCalledTimes(1))
    expect(onTrigger).not.toHaveBeenCalled()

    rerender({ active: false, blocked: true })
    rerender({ active: true, blocked: false })
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 25)) })

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('reports an unreachable network as connector reliability instead of a dataset anomaly', async () => {
    const source = {
      ...newCard('source', 0),
      id: 'source',
      data: { ...newCard('source', 0).data, label: 'Customers', datahubUrn: audit.urn },
    }
    const monitor = { ...newCard('monitor', 1), id: 'monitor' }
    const onIncident = vi.fn(async () => undefined)

    renderHook(() => useLiveIncidentMonitor({
      active: true,
      agentBlocked: false,
      nodes: [source, monitor],
      edges: [{ id: 'source-monitor', source: source.id, target: monitor.id }],
      audit: vi.fn(async () => { throw new Error('connect ENETUNREACH datahub.internal') }),
      onIncident,
      onTrigger: vi.fn(async () => undefined),
    }))

    await waitFor(() => expect(onIncident).toHaveBeenCalledTimes(1))
    expect(onIncident).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('No network'),
      sourceSystem: 'SAM LAB connectivity',
      fingerprint: 'connectivity:offline',
      detail: expect.stringContaining('Dataset health was not evaluated'),
    }))
  })

  it('keeps a branch trigger queued during Human Review and drains it after unblock', async () => {
    vi.useFakeTimers()
    try {
      const source = {
        ...newCard('source', 0),
        id: 'source',
        data: { ...newCard('source', 0).data, datahubUrn: audit.urn },
      }
      const monitor = { ...newCard('monitor', 1), id: 'monitor' }
      const onTrigger = vi.fn(async () => undefined)
      const { rerender } = renderHook(
        ({ blocked }) => useLiveIncidentMonitor({
          active: true,
          agentBlocked: blocked,
          nodes: [source, monitor],
          edges: [{ id: 'source-monitor', source: source.id, target: monitor.id }],
          audit: vi.fn(async () => audit),
          onIncident: vi.fn(async () => undefined),
          onTrigger,
        }),
        { initialProps: { blocked: true } },
      )

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(onTrigger).not.toHaveBeenCalled()
      rerender({ blocked: false })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'evidence-change',
        monitor: expect.objectContaining({ monitorId: 'monitor' }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the reviewed branch blocked while an independent monitor branch continues', async () => {
    vi.useFakeTimers()
    try {
      const sourceA = { ...newCard('source', 0), id: 'source-a', data: { ...newCard('source', 0).data, datahubUrn: `${audit.urn}:a` } }
      const monitorA = { ...newCard('monitor', 1), id: 'monitor-a' }
      const sourceB = { ...newCard('source', 2), id: 'source-b', data: { ...newCard('source', 2).data, datahubUrn: `${audit.urn}:b` } }
      const monitorB = { ...newCard('monitor', 3), id: 'monitor-b' }
      const onTrigger = vi.fn(async () => undefined)

      renderHook(() => useLiveIncidentMonitor({
        active: true,
        agentBusy: false,
        reviewBlockedBranchId: 'monitor-a',
        nodes: [sourceA, monitorA, sourceB, monitorB],
        edges: [
          { id: 'source-monitor-a', source: sourceA.id, target: monitorA.id },
          { id: 'source-monitor-b', source: sourceB.id, target: monitorB.id },
        ],
        audit: vi.fn(async (urn) => ({ ...audit, urn })),
        onIncident: vi.fn(async () => undefined),
        onTrigger,
      }))

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(onTrigger).toHaveBeenCalledTimes(1)
      expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({
        monitor: expect.objectContaining({ monitorId: 'monitor-b' }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires a fresh audit before resolving an applied correction', async () => {
    vi.useFakeTimers()
    try {
      const source = { ...newCard('source', 0), id: 'source', data: { ...newCard('source', 0).data, datahubUrn: audit.urn } }
      const monitor = { ...newCard('monitor', 1), id: 'monitor' }
      const verificationRequests = {
        current: new Map([['monitor::urn:li:dataset:(urn:li:dataPlatform:snowflake,customers,PROD)', {
          incidentKey: 'incident',
          versionId: 'version-1',
          baselineFingerprint: 'before',
          registeredAt: '2026-07-23T20:00:00.000Z',
        }]]),
      }
      const onIncident = vi.fn(async () => undefined)
      const onTrigger = vi.fn(async () => undefined)

      renderHook(() => useLiveIncidentMonitor({
        active: true,
        agentBusy: false,
        nodes: [source, monitor],
        edges: [{ id: 'source-monitor', source: source.id, target: monitor.id }],
        audit: vi.fn(async () => ({
          ...audit,
          reads: audit.reads.map((read) => ({ ...read, status: 'ok' as const, stale: false, summary: 'Fresh evidence is healthy' })),
        })),
        onIncident,
        onTrigger,
        verificationRequests,
      }))

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(onIncident).toHaveBeenCalledWith(expect.objectContaining({
        incidentKey: 'incident',
        transition: 'recovered',
        versionId: 'version-1',
      }))
      expect(onTrigger).not.toHaveBeenCalled()
      expect(verificationRequests.current.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
