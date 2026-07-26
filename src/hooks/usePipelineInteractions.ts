import { addEdge, reconnectEdge, type Connection, type Edge } from '@xyflow/react'
import { useRef, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import type { DataHubAssetSummary } from '../domain/datahub'
import { incidentDiagramNodeIds } from '../domain/incident-diagram'
import { createPipelineExport, parsePipelineExport } from '../domain/pipeline-io'
import { cardLabels, newCard, type AgentProposal, type CardKind, type PipelineNode } from '../domain/pipeline'
import { errorMessage, notifyError } from '../domain/toasts'
import type { PipelineVersion } from '../domain/versioning'

export interface PipelineFlowInstance {
  fitView(options?: { duration?: number; padding?: number; nodes?: { id: string }[] }): Promise<boolean>
  screenToFlowPosition(point: { x: number; y: number }): { x: number; y: number }
}

export function usePipelineInteractions(options: {
  edges: Edge[]
  inspectorOpen: boolean
  invalidateDataHubContext(urn?: string): Promise<unknown>
  libraryOpen: boolean
  nodes: PipelineNode[]
  persistImportedWorkspace(input: {
    projectTitle: string
    nodes: PipelineNode[]
    edges: Edge[]
    versions: PipelineVersion[]
    projectSettings: { inspectorOpen: boolean; libraryOpen: boolean }
  }): Promise<unknown>
  projectTitle: string
  selected?: PipelineNode
  selectedId: string
  setActivity(value: string): void
  setContextMenu: Dispatch<SetStateAction<{ nodeId: string; label: string; x: number; y: number } | undefined>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setProjectTitle(value: string): void
  setProposal: Dispatch<SetStateAction<AgentProposal | undefined>>
  setSelectedId(value: string): void
  setVersions: Dispatch<SetStateAction<PipelineVersion[]>>
  versions: PipelineVersion[]
}) {
  const flowInstance = useRef<PipelineFlowInstance | null>(null)

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    const feedback = connection.sourceHandle === 'feedback'
    options.setEdges((current) => addEdge({ ...connection, id: `e-${connection.source}-${connection.target}-${Date.now()}`, type: 'elastic', label: feedback ? 'next iteration' : undefined }, current))
    options.setActivity(feedback ? 'Feedback boundary added · each trigger starts a new bounded atomic iteration' : 'Manual lineage connection added · run validation before publishing')
  }

  const onReconnect = (oldEdge: Edge, connection: Connection) => {
    if (!connection.source || !connection.target) return
    const feedback = connection.sourceHandle === 'feedback'
    options.setEdges((current) => reconnectEdge(oldEdge, connection, current, { shouldReplaceId: false }).map((edge) => edge.id === oldEdge.id
      ? { ...edge, type: 'elastic', label: feedback ? 'next iteration' : undefined }
      : edge))
    options.setActivity(feedback ? 'Feedback cable reconnected · next bounded iteration preserved' : 'Elastic cable reconnected · lineage validation refreshed')
  }

  const addCard = (kind: CardKind, position?: { x: number; y: number }) => {
    const created = newCard(kind, options.nodes.length)
    const node = position ? { ...created, position } : created
    options.setNodes((current) => [...current, node])
    options.setSelectedId(node.id)
    options.setActivity(`${cardLabels[kind]} card added as draft${position ? ' at the drop position' : ''}`)
  }

  const dropLibraryCard = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rawKind = event.dataTransfer.getData('application/sam-lab-card')
    if (!rawKind || !(rawKind in cardLabels) || !flowInstance.current) return
    const point = flowInstance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addCard(rawKind as CardKind, { x: point.x - 116, y: point.y - 66 })
  }

  const updateSelected = (patch: Partial<PipelineNode['data']>) => {
    options.setNodes((current) => current.map((node) => node.id === options.selectedId ? { ...node, data: { ...node.data, ...patch } } : node))
  }

  const focusIncidentDiagram = (diagramId: string) => {
    const nodeIds = incidentDiagramNodeIds(diagramId, options.nodes, options.edges)
    if (!nodeIds.length) {
      options.setActivity('Incident Diagram unavailable · no connected workstream found')
      return
    }
    void flowInstance.current?.fitView({ duration: 260, padding: 0.24, nodes: nodeIds.map((id) => ({ id })) })
    options.setActivity(`Incident workstream focused · ${nodeIds.length} cards across its parallel branches`)
  }

  const bindDataHubSource = (asset: DataHubAssetSummary) => {
    if (!options.selected || options.selected.data.kind !== 'source') return
    const selected = options.selected
    const previousUrn = selected.data.datahubUrn
    options.setNodes((current) => current.map((node) => node.id === selected.id ? {
      ...node,
      data: {
        ...node.data,
        connectorId: asset.connectorId ?? 'datahub',
        sourceSystem: asset.sourceSystem ?? 'DataHub',
        assetRef: asset.assetRef ?? asset.urn,
        datahubUrn: (asset.connectorId ?? 'datahub') === 'datahub' ? asset.urn : undefined,
        datahubPlatform: asset.platform,
        datahubEnvironment: asset.environment,
        datahubDomain: asset.domain,
        datahubTags: asset.tags,
        datahubQuality: asset.qualityStatus,
        datahubFreshness: asset.freshness,
        datahubUpstream: asset.upstream,
        datahubDownstream: asset.downstream,
        label: asset.name,
        description: asset.description,
        owner: asset.owners[0] ?? 'Unassigned',
        schema: asset.fields,
        status: asset.qualityStatus === 'failing' || asset.owners.length === 0 ? 'warning' : 'healthy',
      },
    } : node))
    if (previousUrn && previousUrn !== asset.urn) void options.invalidateDataHubContext(previousUrn)
    void options.invalidateDataHubContext(asset.urn)
    options.setActivity(`${asset.name} bound atomically · ${asset.fields.length} fields · ${asset.downstream.length} downstream assets · fresh MCP read required before agent execution`)
  }

  const deleteCard = (nodeId: string) => {
    const node = options.nodes.find((candidate) => candidate.id === nodeId)
    const attachedEdges = options.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length
    options.setNodes((current) => current.filter((candidate) => candidate.id !== nodeId))
    options.setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    if (options.selectedId === nodeId) options.setSelectedId('')
    options.setContextMenu(undefined)
    options.setActivity(`${node?.data.label ?? 'Card'} deleted · ${attachedEdges} attached edge${attachedEdges === 1 ? '' : 's'} removed`)
  }

  const exportPipelineJson = () => {
    const artifact = createPipelineExport(options.projectTitle, options.nodes, options.edges, options.versions)
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${options.projectTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sam-lab-pipeline'}.json`
    link.click()
    URL.revokeObjectURL(url)
    options.setActivity(`Pipeline exported · schema v${artifact.schemaVersion} · credentials and local paths excluded`)
  }

  const importPipelineJson = async (file: File) => {
    try {
      const artifact = parsePipelineExport(await file.text())
      options.setNodes(artifact.graph.nodes)
      options.setEdges(artifact.graph.edges)
      options.setVersions(artifact.versions)
      options.setProjectTitle(artifact.projectTitle)
      options.setSelectedId(artifact.graph.nodes[0]?.id ?? '')
      options.setProposal(undefined)
      await options.persistImportedWorkspace({ projectTitle: artifact.projectTitle, nodes: artifact.graph.nodes, edges: artifact.graph.edges, versions: artifact.versions, projectSettings: { inspectorOpen: options.inspectorOpen, libraryOpen: options.libraryOpen } })
      options.setActivity(`Pipeline imported after full validation · ${artifact.graph.nodes.length} cards · schema v${artifact.schemaVersion}`)
    } catch (error) {
      notifyError(error, 'Pipeline import failed')
      options.setActivity(`Import rejected · ${errorMessage(error, 'Invalid pipeline file')} · active workspace unchanged`)
    }
  }

  const fitCommittedGraph = () => {
    window.requestAnimationFrame(() => {
      void flowInstance.current?.fitView({ duration: 240, padding: 0.22 })
    })
  }

  return {
    addCard,
    bindDataHubSource,
    deleteCard,
    dropLibraryCard,
    exportPipelineJson,
    fitCommittedGraph,
    flowInstance,
    focusIncidentDiagram,
    importPipelineJson,
    onConnect,
    onReconnect,
    updateSelected,
  }
}
