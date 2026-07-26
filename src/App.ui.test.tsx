// @vitest-environment jsdom

import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AgentPrompt } from './components/shared/AgentPrompt'
import { disconnectedAiStatus, disconnectedChatGPTStatus } from './hooks/useAiConnections'

interface MockNode {
  id: string
  position: { x: number; y: number }
  data: { kind: string; label: string; runState?: string }
}

interface MockFlowProps {
  children?: ReactNode
  nodes: MockNode[]
  onDrop?(event: ReactDragEvent<HTMLDivElement>): void
  onInit?(instance: {
    fitView(options?: { duration?: number; padding?: number }): Promise<boolean>
    screenToFlowPosition(point: { x: number; y: number }): { x: number; y: number }
  }): void
}

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => null,
    BackgroundVariant: { Lines: 'lines' },
    BaseEdge: () => null,
    Controls: () => null,
    EdgeLabelRenderer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    MiniMap: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: ({ children, nodes, onDrop, onInit }: MockFlowProps) => {
      const initialized = React.useRef(false)
      React.useEffect(() => {
        if (initialized.current) return
        initialized.current = true
        onInit?.({ fitView: vi.fn(async () => true), screenToFlowPosition: (point) => point })
      }, [onInit])
      return <div data-testid="pipeline-flow" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        {nodes.map((node) => <div
          data-kind={node.data.kind}
          data-node-id={node.id}
          data-run-state={node.data.runState ?? 'idle'}
          data-x={node.position.x}
          data-y={node.position.y}
          key={node.id}
        >{node.data.label}</div>)}
        {children}
      </div>
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = React.useState(initial)
      return [edges, setEdges, vi.fn()]
    },
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = React.useState(initial)
      return [nodes, setNodes, vi.fn()]
    },
  }
})

class DataTransferStub {
  dropEffect = 'none'
  effectAllowed = 'all'
  private readonly values = new Map<string, string>()

  getData(format: string) {
    return this.values.get(format) ?? ''
  }

  setData(format: string, value: string) {
    this.values.set(format, value)
  }
}

afterEach(() => cleanup())

beforeEach(() => {
  window.localStorage.clear()
  delete window.dataLab
})

function installElectronWorkspaceMock(state: Awaited<ReturnType<NonNullable<typeof window.dataLab>['loadWorkspaceState']>>) {
  const autosaveWorkspace = vi.fn(async () => ({ saved: true as const, workspaceId: state.activeWorkspaceId ?? 'workspace', updatedAt: new Date().toISOString() }))
  const createWorkspace = vi.fn(async (name: string, payload: Parameters<NonNullable<typeof window.dataLab>['createWorkspace']>[1]) => {
    const timestamp = new Date().toISOString()
    return {
      activeWorkspaceId: 'workspace-auto',
      activeWorkspace: { id: 'workspace-auto', name, archived: false, dirty: false, createdAt: timestamp, updatedAt: timestamp, payload },
      uncleanShutdown: false,
      workspaces: [{ id: 'workspace-auto', name, archived: false, dirty: false, createdAt: timestamp, updatedAt: timestamp }],
    }
  })
  const api = {
    runtime: 'electron' as const,
    platform: 'darwin' as const,
    getAiStatus: vi.fn(async () => disconnectedAiStatus),
    getChatGPTStatus: vi.fn(async () => disconnectedChatGPTStatus),
    getActiveAiSource: vi.fn(async () => ({ source: 'openai' as const })),
    connectChatGPT: vi.fn(async () => disconnectedChatGPTStatus),
    cancelChatGPTLogin: vi.fn(async () => ({ cancelled: true })),
    cancelAiProposal: vi.fn(async () => ({ cancelled: true })),
    cancelChatGPTProposal: vi.fn(async () => ({ cancelled: true })),
    getDataHubMcpStatus: vi.fn(async () => ({ mode: 'demo' as const, transport: 'demo' as const, message: 'Not connected', toolCount: 0, tools: [], writebackAvailable: false, settings: { transport: 'stdio' as const, url: '', tokenConfigured: false, tokenSource: 'none' as const, encryptionAvailable: false, writebackEnabled: false } })),
    exportDiagnostics: vi.fn(async () => ({ schemaVersion: 1 as const, generatedAt: new Date().toISOString(), telemetryEnabled: false as const, settings: { enabled: true, level: 'all' as const, retentionDays: 7, maximumEvents: 500 }, events: [] })),
    getDiagnosticSettings: vi.fn(async () => ({ enabled: true, level: 'all' as const, retentionDays: 7, maximumEvents: 500 })),
    saveDiagnosticSettings: vi.fn(async (settings: { enabled: boolean; level: 'all' | 'warnings' | 'errors'; retentionDays: number; maximumEvents: number }) => settings),
    openDiagnosticLogs: vi.fn(async () => ({ opened: true as const, path: '/tmp/sam-lab-diagnostics.json' })),
    recordDiagnostic: vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() })),
    listIncidentEvents: vi.fn(async () => []),
    recordIncidentEvent: vi.fn(async () => ({ recorded: true })),
    clearIncidentEvents: vi.fn(async () => ({ deleted: 0 })),
    listAgentProposalMemory: vi.fn(async () => []),
    rememberAgentProposal: vi.fn(async (proposal: { graphFingerprint: string; baseGraphFingerprint: string; source: 'pipeline' | 'card-rework'; title: string; summary: string; rationale: string }) => ({
      id: `memory-${proposal.graphFingerprint}`,
      scopeId: state.activeWorkspaceId ?? 'workbench',
      ...proposal,
      status: 'generated' as const,
      occurrenceCount: 1,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    })),
    updateAgentProposalMemoryStatus: vi.fn(async (graphFingerprint: string, status: 'generated' | 'pending-review' | 'committed' | 'rejected' | 'invalid' | 'duplicate', versionId?: string) => ({
      id: `memory-${graphFingerprint}`,
      scopeId: state.activeWorkspaceId ?? 'workbench',
      graphFingerprint,
      baseGraphFingerprint: '0000000000000000',
      source: 'pipeline' as const,
      title: 'Remembered SAM proposal',
      summary: 'Remembered proposal summary',
      rationale: 'Remembered proposal rationale',
      status,
      occurrenceCount: 1,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      versionId,
    })),
    loadWorkspaceState: vi.fn(async () => state),
    createWorkspace,
    autosaveWorkspace,
    resolveWorkspaceRecovery: vi.fn(async () => ({ ...state, recovery: undefined, uncleanShutdown: false })),
    deleteWorkspace: vi.fn(async () => state),
    getWindowState: vi.fn(async () => ({ fullscreen: false })),
    onWindowStateChanged: vi.fn(() => () => undefined),
    onHumanReviewOpened: vi.fn(() => () => undefined),
  } as unknown as NonNullable<typeof window.dataLab>
  window.dataLab = api
  return { api, autosaveWorkspace, createWorkspace }
}

function savedEmptyWorkspaceState(id = 'incident-workspace') {
  const timestamp = '2026-07-22T20:00:00.000Z'
  const payload = { projectTitle: 'Incident workspace', nodes: [], edges: [], versions: [] }
  const summary = { id, name: 'Incident workspace', archived: false, dirty: false, createdAt: timestamp, updatedAt: timestamp }
  return {
    activeWorkspace: { ...summary, payload },
    activeWorkspaceId: id,
    uncleanShutdown: false,
    workspaces: [summary],
  }
}

describe('visual pipeline workspace regressions', () => {
  it('opens a new install blank, with zero versions and no false successful run state', async () => {
    render(<App />)

    expect(screen.getAllByText('0 cards', { exact: false }).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: 'Play autonomous agent' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Pause autonomous agent' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Stop autonomous agent' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Pipeline is empty')).toBeTruthy()
    expect(screen.queryByText('All atomic checks passed')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'What should the SAM LAB agent do?' })).toBeNull()
  })

  it('uses Play on an empty workbench as a governed DataHub bootstrap mission', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({ activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] })
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: { title: 'No candidate', summary: 'No governed candidate was found.', rationale: 'Do not invent a source.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
    }))
    api.recordDiagnostic = vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() }))

    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    expect(api.runChatGPTProposal).toHaveBeenCalledWith(expect.objectContaining({
      objective: expect.stringContaining('governed'),
      graph: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ kind: 'control' })]) }),
    }))
  })

  it('uses one bounded license discovery for an empty autonomous workbench', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({ activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] })
    const asset = {
      urn: 'urn:li:dataset:(urn:li:dataPlatform:dbt,sam.license_utilization,PROD)',
      name: 'license_utilization',
      platform: 'dbt',
      environment: 'PROD',
      description: 'Governed aggregate software license utilization',
      owners: ['Data Platform'],
      tags: [],
      fields: [],
      qualityStatus: 'unavailable' as const,
      upstream: [],
      downstream: [],
      freshness: { capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), stale: false },
    }
    const inspectedAsset = {
      ...asset,
      owners: ['Data Platform'],
      fields: [{ name: 'purchased_seats', type: 'number' as const }],
      qualityStatus: 'healthy' as const,
    }
    api.getDataHubMcpStatus = vi.fn(async () => ({ mode: 'connected' as const, transport: 'stdio' as const, message: 'MCP studio connected', toolCount: 8, tools: [], writebackAvailable: false, settings: { transport: 'stdio' as const, url: 'http://localhost:8080', tokenConfigured: false, tokenSource: 'none' as const, encryptionAvailable: false, writebackEnabled: false } }))
    api.searchDataHubAssets = vi.fn(async () => [asset])
    api.inspectDataHubAsset = vi.fn(async () => ({ asset: inspectedAsset, evidence: [{
      name: 'get_entities' as const,
      status: 'ok' as const,
      summary: 'Governed dataset identity returned.',
      capturedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      cached: false,
      stale: false,
    }] }))
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: { title: 'Use governed source', summary: 'Use the catalog result.', rationale: 'DataHub returned a governed source.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
    }))

    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))

    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    expect(api.searchDataHubAssets).toHaveBeenCalledTimes(1)
    expect(api.searchDataHubAssets).toHaveBeenCalledWith('license')
    expect(api.inspectDataHubAsset).toHaveBeenNthCalledWith(1, asset.urn, false, 'summary')
    expect(api.inspectDataHubAsset).toHaveBeenNthCalledWith(2, asset.urn, false, 'deep')
    expect(api.runChatGPTProposal).toHaveBeenCalledWith(expect.objectContaining({
      datahubEvidence: expect.arrayContaining([
        expect.stringContaining('Starting dataset candidate selected after complete catalog exploration: license_utilization'),
        expect.stringContaining('Selected schema: purchased_seats:number'),
      ]),
    }))
    expect(api.recordIncidentEvent).not.toHaveBeenCalledWith(expect.objectContaining({ incidentKey: 'source-discovery:datahub', transition: 'opened' }))
  })

  it('builds from the first usable catalog dataset before continuing the remaining audit locally', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({ activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] })
    const assets = Array.from({ length: 9 }, (_, index) => ({
      urn: `urn:li:dataset:(urn:li:dataPlatform:dbt,sam.license_dataset_${index},PROD)`,
      name: `license_dataset_${index}`,
      platform: 'dbt',
      environment: 'PROD',
      description: 'Governed software license dataset',
      owners: ['Data Platform'],
      tags: ['governed'],
      fields: [{ name: 'id', type: 'string' as const }],
      qualityStatus: 'healthy' as const,
      upstream: [],
      downstream: [],
      freshness: { capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), stale: false },
    }))
    api.getDataHubMcpStatus = vi.fn(async () => ({ mode: 'connected' as const, transport: 'stdio' as const, message: 'MCP studio connected', toolCount: 8, tools: [], writebackAvailable: false, settings: { transport: 'stdio' as const, url: 'http://localhost:8080', tokenConfigured: false, tokenSource: 'none' as const, encryptionAvailable: false, writebackEnabled: false } }))
    api.searchDataHubAssets = vi.fn(async () => assets)
    api.inspectDataHubAsset = vi.fn(async (urn: string) => ({
      asset: assets.find((asset) => asset.urn === urn)!,
      evidence: [{
        name: 'get_entities' as const,
        status: 'ok' as const,
        summary: 'Governed dataset identity returned.',
        capturedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        cached: false,
        stale: false,
      }],
    }))
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    let inspectedBeforeProposal = new Set<string>()
    api.runChatGPTProposal = vi.fn(async () => {
      inspectedBeforeProposal = new Set((api.inspectDataHubAsset as ReturnType<typeof vi.fn>).mock.calls.map(([urn]) => String(urn)))
      return {
        model: 'gpt-5.6-sol',
        proposal: { title: 'Catalog complete', summary: 'Build from the completed checkpoint.', rationale: 'Every catalog identity received a bounded read.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
      }
    })

    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))

    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    expect(inspectedBeforeProposal).toEqual(new Set([assets[0]!.urn]))
    expect(api.recordIncidentEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      incidentKey: 'source-discovery:datahub',
      transition: 'opened',
    }))
  })

  it('pauses future autonomous iterations and Stop cancels the active provider channels', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({ activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] })
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: { title: 'No change', summary: 'No evidence change.', rationale: 'The graph is current.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
    }))
    api.recordDiagnostic = vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() }))

    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Pause autonomous agent' }))
    expect(screen.getByText('paused')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'Stop autonomous agent' }))
    expect(api.cancelAiProposal).toHaveBeenCalled()
    expect(api.cancelChatGPTProposal).toHaveBeenCalled()
    expect(screen.getByText('stopped')).toBeTruthy()
  })

  it('does not recover a provider incident when a stopped provider turn resolves late', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock(savedEmptyWorkspaceState('provider-workspace'))
    api.listIncidentEvents = vi.fn(async () => [{
      id: 'provider-offline',
      incidentKey: 'connectivity:provider:chatgpt',
      transition: 'opened' as const,
      severity: 'critical' as const,
      title: 'ChatGPT unavailable',
      detail: 'The previous provider request timed out.',
      sourceSystem: 'SAM LAB connectivity',
      fingerprint: 'connectivity:timeout',
      createdAt: '2026-07-24T08:00:00.000Z',
    }])
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    type ChatGPTProposalResponse = Awaited<ReturnType<NonNullable<typeof window.dataLab>['runChatGPTProposal']>>
    let resolveProposal!: (response: ChatGPTProposalResponse) => void
    api.runChatGPTProposal = vi.fn(() => new Promise<ChatGPTProposalResponse>((resolve) => { resolveProposal = resolve }))

    render(<App />)
    await screen.findByLabelText('1 reports requiring attention')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Stop autonomous agent' }))
    await act(async () => {
      resolveProposal({
        model: 'gpt-5.6-sol',
        proposal: { title: 'Late response', summary: 'Discarded.', rationale: 'The run was stopped.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
      })
      await Promise.resolve()
    })

    expect(api.recordIncidentEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      incidentKey: 'connectivity:provider:chatgpt',
      transition: 'recovered',
    }))
    expect(screen.getByText('stopped')).toBeTruthy()
  })

  it('blocks live-monitor agent triggers while the initial Play audit is starting', async () => {
    const user = userEvent.setup()
    const sourceNode = {
      id: 'source',
      type: 'pipeline' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'source' as const, label: 'Orders', description: 'Governed source', owner: 'Data', status: 'healthy' as const, schema: [], datahubUrn: 'urn:orders' },
    }
    const monitorNode = {
      id: 'monitor',
      type: 'pipeline' as const,
      position: { x: 300, y: 0 },
      data: { kind: 'monitor' as const, label: 'Watch orders', description: 'Watch metadata', owner: 'Agent', status: 'healthy' as const, schema: [], rule: 'on_change(metadata_fingerprint) | cooldown=10s | max_iterations=10' },
    }
    const initialState = {
      activeWorkspaceId: 'monitored-workspace',
      activeWorkspace: { id: 'monitored-workspace', name: 'Monitored', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z', payload: { projectTitle: 'Monitored', nodes: [sourceNode, monitorNode], edges: [{ id: 'source-monitor', source: 'source', target: 'monitor' }], versions: [] } },
      uncleanShutdown: false,
      workspaces: [{ id: 'monitored-workspace', name: 'Monitored', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }],
    }
    const { api } = installElectronWorkspaceMock(initialState)
    const connectedChatGPT = { ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }
    let releaseStartupStatus!: (status: typeof connectedChatGPT) => void
    const startupStatus = new Promise<typeof connectedChatGPT>((resolve) => { releaseStartupStatus = resolve })
    let chatGPTStatusReads = 0
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(() => {
      chatGPTStatusReads += 1
      return chatGPTStatusReads === 1 ? Promise.resolve(connectedChatGPT) : startupStatus
    })
    api.getDataHubMcpStatus = vi.fn(async () => ({ mode: 'connected' as const, transport: 'stdio' as const, message: 'MCP studio connected', toolCount: 8, tools: [], writebackAvailable: false, settings: { transport: 'stdio' as const, url: '', tokenConfigured: false, tokenSource: 'none' as const, encryptionAvailable: false, writebackEnabled: false } }))
    api.auditDataHubWithMcp = vi.fn(async () => ({
      urn: 'urn:orders',
      transport: 'stdio' as const,
      reads: [{ name: 'get_entities' as const, status: 'error' as const, summary: 'DataHub read unavailable', capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), cached: false, stale: false }],
    }))

    render(<App />)
    await screen.findByText('Orders')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await waitFor(() => expect(api.getDataHubMcpStatus).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.auditDataHubWithMcp).toHaveBeenCalledTimes(1))

    expect(api.getChatGPTStatus).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Stop autonomous agent' }))
    releaseStartupStatus(connectedChatGPT)
  })

  it('stops idle monitoring without rewriting a waiting graph card', async () => {
    const user = userEvent.setup()
    const reviewNode = {
      id: 'review',
      type: 'pipeline' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'review' as const, label: 'Human checkpoint', description: 'Wait for approval', owner: 'Reviewer', status: 'healthy' as const, schema: [] },
    }
    const initialState = {
      activeWorkspaceId: 'waiting-workspace',
      activeWorkspace: { id: 'waiting-workspace', name: 'Waiting', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z', payload: { projectTitle: 'Waiting', nodes: [reviewNode], edges: [], versions: [] } },
      uncleanShutdown: false,
      workspaces: [{ id: 'waiting-workspace', name: 'Waiting', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }],
    }
    const { api } = installElectronWorkspaceMock(initialState)
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: { title: 'No change', summary: 'Review remains pending.', rationale: 'No evidence supports a mutation.', requires_human_review: false, confidence: 1, writeback: 'None.', evidence: [], actions: [] },
    }))
    api.recordDiagnostic = vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() }))

    render(<App />)
    const flow = screen.getByTestId('pipeline-flow')
    await screen.findByText('Human checkpoint')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(flow.querySelector('[data-node-id="review"]')?.getAttribute('data-run-state')).toBe('waiting'))

    await user.click(screen.getByRole('button', { name: 'Stop autonomous agent' }))

    expect(flow.querySelector('[data-node-id="review"]')?.getAttribute('data-run-state')).toBe('waiting')
    expect(screen.getByText('stopped')).toBeTruthy()
  })

  it('keeps Reports and Results as separate entries alongside the other workspace panels', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('region', { name: 'Card library content' }).classList.contains('panel-scroll-area')).toBe(true)
    expect(screen.getByRole('region', { name: 'Inspector content' }).classList.contains('panel-scroll-area')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Close card library' }))
    expect(screen.getByRole('button', { name: 'Open card library' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close inspector' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open card library' }))
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(screen.getByRole('button', { name: 'Open inspector' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close card library' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open inspector' }))
    expect(screen.getByRole('button', { name: 'Close inspector' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open impact and risks' }))
    expect(screen.getByRole('button', { name: 'Close impact and risks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Impact & Risks' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Impact and risks content' }).classList.contains('panel-scroll-area')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open inspector' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open incident reports' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open analysis results' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open inspector' }))
    const actionsSticker = screen.getByRole('button', { name: 'Open agent actions' })
    expect(actionsSticker.querySelector('em')).toBeNull()
    await user.click(actionsSticker)
    const closeActions = screen.getByRole('button', { name: 'Close agent actions' })
    const actionsScroller = screen.getByRole('region', { name: 'Agent actions content' })
    const clearActions = screen.getByRole('button', { name: 'Clear action timeline' })
    expect(closeActions.closest('#sam-lab-left-panel')).toBeTruthy()
    expect(actionsScroller.classList.contains('panel-scroll-area')).toBe(true)
    expect(actionsScroller.compareDocumentPosition(clearActions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(clearActions.closest('.panel-footer-actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close inspector' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open card library' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open live logs' }))
    expect(screen.getByRole('button', { name: 'Close live logs' }).closest('#sam-lab-left-panel')).toBeTruthy()
    const liveLogScroller = screen.getByRole('region', { name: 'Live activity content' })
    const clearLiveLog = screen.getByRole('button', { name: 'Clear session log' })
    expect(liveLogScroller.classList.contains('panel-scroll-area')).toBe(true)
    expect(liveLogScroller.compareDocumentPosition(clearLiveLog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(clearLiveLog.closest('.panel-footer-actions')).toBeTruthy()
    expect(screen.getByText('Simple session timeline · newest first')).toBeTruthy()
    await user.click(clearLiveLog)
    expect(screen.getByText('Play the graph or change a setting to start the live timeline.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Clear session log' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Open incident reports' }))
    expect(screen.getByRole('button', { name: 'Close incident reports' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Incident reports content' }).classList.contains('panel-scroll-area')).toBe(true)
    expect(screen.getByText('No unresolved incident')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open analysis results' }))
    expect(screen.getByRole('dialog', { name: 'Analysis report' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close analysis results' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close live logs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close incident reports' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Analysis results content' }).classList.contains('panel-scroll-area')).toBe(true)
    expect(screen.getByText('No materialized risk')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close analysis results' }))
    await user.click(screen.getByRole('button', { name: 'Close incident reports' }))

    const inspectorSticker = screen.getByRole('button', { name: 'Open inspector' })
    expect(inspectorSticker.children[0]?.textContent).toBe('Inspector')
    expect(inspectorSticker.children[1]?.tagName.toLowerCase()).toBe('svg')
  })

  it('returns from a risk card inspector to the preserved Risks panel', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByTitle('Click to add or drag Compliance Risk onto the canvas'))
    await user.click(screen.getByRole('button', { name: 'Open impact and risks' }))
    await user.click(screen.getByRole('tab', { name: 'General' }))
    const riskScroller = screen.getByRole('region', { name: 'Impact and risks content' })
    Object.defineProperty(riskScroller, 'scrollTop', { configurable: true, value: 96, writable: true })
    riskScroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    await user.click(screen.getByRole('button', { name: 'Inspect New Compliance Risk' }))

    expect(screen.getByRole('button', { name: 'Back to Risks' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to Risks' }))
    expect(screen.getByRole('heading', { name: 'Impact & Risks' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Impact and risks content' }).scrollTop).toBe(96)
  })

  it('shows one Reports badge per unresolved incident rather than per event', async () => {
    const { api } = installElectronWorkspaceMock(savedEmptyWorkspaceState('reports-workspace'))
    api.listIncidentEvents = vi.fn(async () => [
      { id: 'incident-open', incidentKey: 'orders-drift', transition: 'opened' as const, severity: 'warning' as const, title: 'Orders drift', detail: 'Schema changed.', createdAt: '2026-07-23T20:00:00.000Z' },
      { id: 'incident-worse', incidentKey: 'orders-drift', transition: 'worsened' as const, severity: 'critical' as const, title: 'Orders drift', detail: 'More fields changed.', createdAt: '2026-07-23T20:01:00.000Z' },
    ])

    render(<App />)

    expect(await screen.findByLabelText('1 reports requiring attention')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open incident reports' }))
    expect(screen.getByText('1 unique incident')).toBeTruthy()
    expect(screen.getByText('1 occurrence', { exact: false })).toBeTruthy()
  })

  it('keeps ChatGPT sign-in retryable and reports why web preview cannot connect', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'AI connectionModel and quality' }))
    const connectButton = screen.getByRole('button', { name: 'Continue with ChatGPT' }) as HTMLButtonElement
    expect(connectButton.disabled).toBe(false)
    await user.click(connectButton)

    expect(await screen.findByText('ChatGPT connection requires Electron')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue with ChatGPT' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('lets the user cancel a pending ChatGPT sign-in without leaving Settings busy', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({ activeWorkspaceId: null, uncleanShutdown: false, workspaces: [] })
    api.connectChatGPT = vi.fn(() => new Promise<never>(() => undefined))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'AI connectionModel and quality' }))
    await user.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel ChatGPT sign-in' }))

    expect(api.cancelChatGPTLogin).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeTruthy()
    expect(screen.getByText('ChatGPT sign-in cancelled. You can retry safely.')).toBeTruthy()
  })

  it('offers real local diagnostic controls without mixing in data incidents', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock(savedEmptyWorkspaceState('diagnostics-workspace'))
    api.exportDiagnostics = vi.fn(async () => ({
      schemaVersion: 1 as const,
      generatedAt: '2026-07-23T23:00:00.000Z',
      telemetryEnabled: false as const,
      settings: { enabled: true, level: 'all' as const, retentionDays: 7, maximumEvents: 500 },
      events: [{ id: 'event-1', timestamp: '2026-07-23T22:59:59.000Z', category: 'provider' as const, action: 'chatgpt.connect.waiting', status: 'info' as const, detail: { stage: 'browser-approval' } }],
    }))
    api.listIncidentEvents = vi.fn(async () => [{
      id: 'incident-1',
      incidentKey: 'orders-drift',
      transition: 'opened' as const,
      severity: 'warning' as const,
      title: 'Orders drift',
      detail: 'Schema changed.',
      createdAt: '2026-07-23T22:58:00.000Z',
    }])
    api.clearIncidentEvents = vi.fn(async () => ({ deleted: 1 }))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'DiagnosticsLocal, private and bounded' }))

    expect(await screen.findByText('Local diagnostic settings')).toBeTruthy()
    expect(screen.getByText('Keep a local technical log')).toBeTruthy()
    expect(screen.getByText('1 sanitized technical event stored')).toBeTruthy()
    expect(screen.queryByText('chatgpt.connect.waiting')).toBeNull()
    expect(await screen.findByText('1 incident report event in this workspace')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Clear incident reports' }))
    expect(screen.getByRole('button', { name: 'Confirm clear reports' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirm clear reports' }))
    await waitFor(() => expect(api.clearIncidentEvents).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('0 incident report events in this workspace')).toBeTruthy()
  })

  it('persists autonomy controls and exposes review, risk and uncertainty policies', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'AutonomyReview and risk policy' }))
    await user.click(screen.getByRole('radio', { name: /Frequent/ }))
    await user.click(screen.getByRole('radio', { name: /Exhaustive/ }))
    await user.click(screen.getByRole('radio', { name: /Report only/ }))

    expect(JSON.parse(window.localStorage.getItem('sam-lab-autonomy-policy') ?? '{}')).toEqual({
      humanReview: 'frequent',
      riskAnalysis: 'exhaustive',
      uncertainty: 'no-change',
    })
    expect(screen.getByText('External mutations and DataHub write-back always keep their separate native confirmation, regardless of autonomy level.')).toBeTruthy()
  })

  it('adds palette cards by click and drops dragged cards at pointer flow-space XY', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const flow = screen.getByTestId('pipeline-flow')
    const sourcePaletteCard = screen.getByTitle('Click to add or drag Asset Source onto the canvas')

    await user.click(sourcePaletteCard)
    const clickedCard = flow.querySelector<HTMLElement>('[data-kind="source"]')
    expect(clickedCard?.dataset.x).toBe('120')
    expect(clickedCard?.dataset.y).toBe('120')

    const transfer = new DataTransferStub()
    const analysisPaletteCard = screen.getByTitle('Click to add or drag Usage Analysis onto the canvas')
    fireEvent.dragStart(analysisPaletteCard, { dataTransfer: transfer })
    const dropEvent = createEvent.drop(flow, { dataTransfer: transfer })
    Object.defineProperties(dropEvent, { clientX: { value: 500 }, clientY: { value: 300 } })
    fireEvent(flow, dropEvent)

    const droppedCard = flow.querySelector<HTMLElement>('[data-kind="analysis"]')
    expect(droppedCard?.dataset.x).toBe('384')
    expect(droppedCard?.dataset.y).toBe('234')
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(2)
  })

  it('restores an explicitly active blank workspace and shows its saved state', async () => {
    installElectronWorkspaceMock({
      activeWorkspaceId: 'blank-workspace',
      activeWorkspace: { id: 'blank-workspace', name: 'Governance blank', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z', payload: { projectTitle: 'Saved blank pipeline', nodes: [], edges: [], versions: [] } },
      uncleanShutdown: false,
      workspaces: [{ id: 'blank-workspace', name: 'Governance blank', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }],
    })
    render(<App />)

    expect(await screen.findByText('Saved blank pipeline')).toBeTruthy()
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.getAllByText('0 cards', { exact: false }).length).toBeGreaterThan(0)
  })

  it('creates a durable SQLite workspace when the blank workbench receives its first card', async () => {
    const user = userEvent.setup()
    const { createWorkspace } = installElectronWorkspaceMock({
      activeWorkspaceId: null,
      uncleanShutdown: false,
      workspaces: [],
    })
    render(<App />)

    await user.click(screen.getByTitle('Click to add or drag Asset Source onto the canvas'))

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledTimes(1), { timeout: 1_500 })
    expect(createWorkspace).toHaveBeenCalledWith('Untitled pipeline', expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ kind: 'source' }) })]),
    }))
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('does not autosave an example over the last active workspace', async () => {
    const user = userEvent.setup()
    const { autosaveWorkspace } = installElectronWorkspaceMock({
      activeWorkspaceId: 'real-workspace',
      activeWorkspace: { id: 'real-workspace', name: 'Real work', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z', payload: { projectTitle: 'Real work', nodes: [], edges: [], versions: [] } },
      uncleanShutdown: false,
      workspaces: [{ id: 'real-workspace', name: 'Real work', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }],
    })
    render(<App />)
    await screen.findByText('Real work')

    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'ExamplesStart empty or explore' }))
    await user.click(screen.getByRole('button', { name: 'Copilot license optimizationAnalyze a DataHub-backed 250-seat Copilot dataset and review USD 9,348 in annual savings.' }))

    expect(await screen.findByText('Copilot license optimization')).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 750))
    await waitFor(() => expect(autosaveWorkspace).not.toHaveBeenCalled())
    expect(screen.getByText('Unsaved')).toBeTruthy()
  })

  it('offers recovery instead of applying a crash draft silently', async () => {
    const user = userEvent.setup()
    const baseline = { projectTitle: 'Committed pipeline', nodes: [], edges: [], versions: [] }
    const draft = { projectTitle: 'Recovered draft', nodes: [], edges: [], versions: [] }
    const { api } = installElectronWorkspaceMock({
      activeWorkspaceId: 'recoverable',
      activeWorkspace: { id: 'recoverable', name: 'Recoverable', archived: false, dirty: true, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:05:00.000Z', payload: baseline },
      recovery: { payload: draft, updatedAt: '2026-07-22T20:05:00.000Z' },
      uncleanShutdown: true,
      workspaces: [{ id: 'recoverable', name: 'Recoverable', archived: false, dirty: true, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:05:00.000Z' }],
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Recover your autosaved work?' })).toBeTruthy()
    expect(screen.getByText('Committed pipeline')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Recover draft' }))
    expect(api.resolveWorkspaceRecovery).toHaveBeenCalledWith('recover')
  })

  it('commits an approved provider proposal into the visible main graph', async () => {
    const user = userEvent.setup()
    const { api } = installElectronWorkspaceMock({
      activeWorkspaceId: null,
      uncleanShutdown: false,
      workspaces: [],
    })
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({
      ...disconnectedChatGPTStatus,
      available: true,
      connected: true,
      selectedModel: 'gpt-5.6-sol',
      selectedEffort: 'high',
    }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: {
        title: 'Create a bounded starting point for the empty pipeline',
        summary: 'Add a placeholder Data Source and a Human Review checkpoint.',
        rationale: 'The intended dataset must be bound before downstream work.',
        requires_human_review: true,
        confidence: 0.99,
        writeback: 'Commit the reviewed graph locally.',
        evidence: ['No DataHub URN is bound.'],
        actions: [
          { type: 'add_card', node_id: 'source-intended-dataset', kind: 'source', label: 'Intended Dataset', description: 'Awaiting a DataHub binding.', owner: 'SAM LAB Agent', rule: 'Bind a trusted dataset before execution.', source: null, target: null, source_handle: null, reason: 'Create the bounded source placeholder.' },
          { type: 'add_card', node_id: 'review-bind-dataset', kind: 'review', label: 'Verify and Bind Dataset', description: 'Human checkpoint.', owner: 'Data steward', rule: 'Approve only after the dataset identity is verified.', source: null, target: null, source_handle: null, reason: 'Require explicit verification.' },
          { type: 'add_edge', node_id: null, kind: null, label: null, description: null, owner: null, rule: null, source: 'source-intended-dataset', target: 'review-bind-dataset', source_handle: null, reason: 'Gate the source binding.' },
        ],
      },
    }) as Awaited<ReturnType<NonNullable<typeof window.dataLab>['runChatGPTProposal']>>)
    api.notifyHumanReview = vi.fn(async () => ({ shown: true }))
    api.recordDiagnostic = vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() }))

    render(<App />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))

    expect(await screen.findByRole('dialog', { name: 'Create a bounded starting point for the empty pipeline' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Approve change' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create a bounded starting point for the empty pipeline' })).toBeNull())
    const flow = screen.getByTestId('pipeline-flow')
    expect(within(flow).getByText('Intended Dataset')).toBeTruthy()
    expect(within(flow).getByText('Verify and Bind Dataset')).toBeTruthy()
    expect(within(flow).getByText('DataHub Catalog Explorer')).toBeTruthy()
    expect(within(flow).getByText('Catalog Audit Worker')).toBeTruthy()
    expect(flow.querySelectorAll('[data-node-id]')).toHaveLength(5)
    expect(screen.getAllByText('5 cards', { exact: false }).length).toBeGreaterThan(0)
    expect(api.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ action: 'proposal.approve', status: 'success' }))
  })

  it('keeps mission prompting out of an active autonomous workspace', async () => {
    const user = userEvent.setup()
    const sourceNode = {
      id: 'billing-source',
      type: 'pipeline' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'source' as const, label: 'Billing', description: 'Existing graph', owner: 'Finance', status: 'healthy' as const, schema: [], datahubUrn: 'urn:billing' },
    }
    const initialState = {
      activeWorkspaceId: 'existing',
      activeWorkspace: { id: 'existing', name: 'Existing', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z', payload: { projectTitle: 'Existing', nodes: [sourceNode], edges: [], versions: [] } },
      uncleanShutdown: false,
      workspaces: [{ id: 'existing', name: 'Existing', archived: false, dirty: false, createdAt: '2026-07-22T20:00:00.000Z', updatedAt: '2026-07-22T20:00:00.000Z' }],
    }
    const { api } = installElectronWorkspaceMock(initialState)
    api.getActiveAiSource = vi.fn(async () => ({ source: 'chatgpt' as const }))
    api.getChatGPTStatus = vi.fn(async () => ({ ...disconnectedChatGPTStatus, available: true, connected: true, selectedModel: 'gpt-5.6-sol', selectedEffort: 'high' }))
    api.commitWorkspace = vi.fn(async () => ({ saved: true as const, workspaceId: 'existing', updatedAt: '2026-07-23T21:00:00.000Z' }))
    api.createWorkspace = vi.fn(async (name, payload) => ({
      activeWorkspaceId: 'separate',
      activeWorkspace: { id: 'separate', name, archived: false, dirty: false, createdAt: '2026-07-23T21:00:01.000Z', updatedAt: '2026-07-23T21:00:01.000Z', payload },
      uncleanShutdown: false,
      workspaces: [...initialState.workspaces, { id: 'separate', name, archived: false, dirty: false, createdAt: '2026-07-23T21:00:01.000Z', updatedAt: '2026-07-23T21:00:01.000Z' }],
    }))
    api.runChatGPTProposal = vi.fn(async () => ({
      model: 'gpt-5.6-sol',
      proposal: {
        title: 'No speculative change',
        summary: 'Wait for a governed source.',
        rationale: 'No DataHub source is bound yet.',
        requires_human_review: false,
        confidence: 1,
        writeback: 'None.',
        evidence: [],
        actions: [],
      },
    }))
    api.recordDiagnostic = vi.fn(async (event) => ({ ...event, id: 'diagnostic', timestamp: new Date().toISOString() }))

    render(<App />)
    await screen.findByText('Billing')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull())
    expect(screen.queryByRole('textbox', { name: 'What should the SAM LAB agent do?' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Play autonomous agent' }))
    await waitFor(() => expect(api.runChatGPTProposal).toHaveBeenCalledTimes(1))
    expect(api.commitWorkspace).not.toHaveBeenCalled()
    expect(api.createWorkspace).not.toHaveBeenCalled()
    expect(screen.getByText('Billing')).toBeTruthy()
  })
})

describe('agent prompt regressions', () => {
  it('does not open Settings when Enter is pressed while disconnected', () => {
    const openSettings = vi.fn()
    const submit = vi.fn()
    render(<AgentPrompt
      activity="Ready"
      busy={false}
      connected={false}
      context={{ cards: 0, edges: 0, versions: 0, mcp: 'MCP not connected', model: 'OpenAI' }}
      onOpenSettings={openSettings}
      onStop={vi.fn()}
      onSubmit={submit}
    />)

    const textarea = screen.getByRole('textbox', { name: 'What should the SAM LAB agent do?' })
    fireEvent.change(textarea, { target: { value: 'Analyze this pipeline' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(openSettings).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe('Analyze this pipeline')
    expect(screen.getByText('Connect an AI source before sending. Your prompt is preserved.')).toBeTruthy()
  })

  it('caps multi-line growth, keeps scrolling on the textarea and leaves actions outside it', () => {
    render(<AgentPrompt
      activity="Ready"
      busy={false}
      connected
      context={{ cards: 0, edges: 0, versions: 0, mcp: 'MCP connected', model: 'Codex' }}
      onOpenSettings={vi.fn()}
      onStop={vi.fn()}
      onSubmit={vi.fn()}
    />)
    const textarea = screen.getByRole('textbox', { name: 'What should the SAM LAB agent do?' })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 160 })

    fireEvent.change(textarea, { target: { value: 'Analyze\nthen rebuild\nthen validate\nthen explain every change' } })

    expect(textarea.style.height).toBe('88px')
    expect(textarea.style.overflowY).toBe('auto')
    const form = textarea.closest('form')
    expect(form).toBeTruthy()
    expect(within(form!).getByRole('button', { name: 'Send request to SAM LAB agent' })).toBeTruthy()
    expect(within(form!).getByRole('button', { name: 'Show agentic details' })).toBeTruthy()
  })
})
