import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, type Connection, type Edge, type EdgeTypes, type NodeChange, type EdgeChange, type NodeTypes, type OnReconnect } from '@xyflow/react'
import { FileWarning, ListChecks, LoaderCircle, PanelLeftOpen, PanelRightOpen, Pencil, ScrollText, ShieldAlert, Trash2 } from 'lucide-react'
import { useMemo, type DragEvent, type MouseEvent } from 'react'
import { PipelineCard } from '../components/PipelineCard'
import { ElasticEdge, ElasticRoutingProvider } from '../components/shared/ElasticEdge'
import { canConnectCardKinds } from '../domain/card-compatibility'
import type { CardKind, PipelineNode } from '../domain/pipeline'
import { graphPerformanceTargets } from '../domain/performance'

const nodeTypes: NodeTypes = { pipeline: PipelineCard }
const edgeTypes: EdgeTypes = { elastic: ElasticEdge }
const miniMapColors: Record<CardKind, string> = {
  control: '#818cf8',
  explorer: '#5eead4',
  worker: '#fdba74',
  query: '#99f6e4',
  source: '#bfdbfe', profile: '#a7f3d0', analysis: '#c7d2fe', impact: '#fed7aa', risk: '#fecaca', patch: '#fbcfe8', monitor: '#a5f3fc', parallel: '#c4b5fd', diagram: '#fde68a',
  split: '#ddd6fe', decision: '#e9d5ff', transform: '#fef3c7', review: '#fecdd3', validation: '#bbf7d0', output: '#bae6fd',
}

interface PipelineCanvasViewProps {
  activityBusy: boolean
  actionsOpen: boolean
  contextMenu?: { nodeId: string; label: string; x: number; y: number }
  edges: Edge[]
  inspectorOpen: boolean
  libraryOpen: boolean
  logsOpen: boolean
  nodes: PipelineNode[]
  reportCount: number
  reportsOpen: boolean
  riskCount: number
  risksOpen: boolean
  onConnect(connection: Connection): void
  onReconnect: OnReconnect<Edge>
  onDeleteCard(nodeId: string): void
  onDrop(event: DragEvent<HTMLDivElement>): void
  onEdgesChange(changes: EdgeChange<Edge>[]): void
  onEditCard(nodeId: string, label: string): void
  onFlowInit(instance: { fitView(options?: { duration?: number; padding?: number; nodes?: { id: string }[] }): Promise<boolean>; screenToFlowPosition(point: { x: number; y: number }): { x: number; y: number } }): void
  onNodeContextMenu(event: MouseEvent<Element>, node: PipelineNode): void
  onNodesChange(changes: NodeChange<PipelineNode>[]): void
  onOpenInspector(): void
  onOpenLibrary(): void
  onOpenLogs(): void
  onOpenActions(): void
  onPaneClick(): void
  onOpenReports(): void
  onOpenRisks(): void
  onSelectNode(nodeId: string): void
  theme: 'light' | 'dark'
}

export function PipelineCanvasView(props: PipelineCanvasViewProps) {
  const { activityBusy, actionsOpen, contextMenu, edges, inspectorOpen, libraryOpen, logsOpen, nodes, onConnect, onDeleteCard, onDrop, onEdgesChange, onEditCard, onFlowInit, onNodeContextMenu, onNodesChange, onOpenActions, onOpenInspector, onOpenLibrary, onOpenLogs, onOpenReports, onOpenRisks, onPaneClick, onReconnect, onSelectNode, reportCount, reportsOpen, riskCount, risksOpen, theme } = props
  const renderedEdges = useMemo(() => edges.map((edge) => ({ ...edge, type: 'elastic', markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.6 } })), [edges])
  const nodeKinds = useMemo(() => new Map(nodes.map((node) => [node.id, node.data.kind])), [nodes])
  const renderMiniMap = nodes.length <= graphPerformanceTargets.minimapNodeLimit
  return <section aria-label="Pipeline canvas" className="canvas-panel" id="sam-lab-canvas" tabIndex={0}>
    <div className="canvas-sticker-stack is-left">
      {!libraryOpen && <button aria-label="Open card library" className="library-open" onClick={onOpenLibrary} title="Open card library" type="button"><PanelLeftOpen size={16} /><span>Cards</span></button>}
      {!actionsOpen && <button aria-label="Open agent actions" className={`actions-open${activityBusy ? ' is-busy' : ''}`} onClick={onOpenActions} title="Open agent actions" type="button">{activityBusy ? <LoaderCircle aria-hidden="true" /> : <ListChecks size={16} />}<span>Actions</span></button>}
      {!logsOpen && <button aria-label="Open live logs" className="logs-open" onClick={onOpenLogs} title="Open live activity log" type="button"><ScrollText size={16} /><span>Live logs</span></button>}
    </div>
    <div className="canvas-sticker-stack is-right">
      {!inspectorOpen && <button aria-label="Open inspector" className="inspector-open" onClick={onOpenInspector} title="Open inspector" type="button"><span>Inspector</span><PanelRightOpen size={16} /></button>}
      {!risksOpen && <button aria-label="Open impact and risks" className={`risks-open${riskCount ? ' has-risks' : ''}`} onClick={onOpenRisks} title={`${riskCount} actionable risk${riskCount === 1 ? '' : 's'} or coverage gap${riskCount === 1 ? '' : 's'}`} type="button"><span>Risks</span><ShieldAlert size={16} />{riskCount > 0 && <em aria-label={`${riskCount} actionable risks or coverage gaps`}>{riskCount > 99 ? '99+' : riskCount}</em>}</button>}
      {!reportsOpen && <button aria-label="Open incident reports" className={`reports-open${reportCount ? ' has-reports' : ''}`} onClick={onOpenReports} title={`${reportCount} incident report${reportCount === 1 ? '' : 's'} requiring attention`} type="button"><span>Reports</span><FileWarning size={16} />{reportCount > 0 && <em aria-label={`${reportCount} reports requiring attention`}>{reportCount > 99 ? '99+' : reportCount}</em>}</button>}
    </div>
    <div className="canvas-toolbar"><div><span className="live-dot" />Live validation</div><div>{nodes.length} cards <span>·</span> {edges.length} edges</div></div>
    <ElasticRoutingProvider nodes={nodes}>
    <ReactFlow
      nodes={nodes}
      edges={renderedEdges}
      edgeTypes={edgeTypes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={(connection) => {
        const source = connection.source ? nodeKinds.get(connection.source) : undefined
        const target = connection.target ? nodeKinds.get(connection.target) : undefined
        return Boolean(source && target && connection.source !== connection.target && canConnectCardKinds(source, target, connection.sourceHandle))
      }}
      onReconnect={onReconnect}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
      onDrop={onDrop}
      onInit={onFlowInit}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onNodeContextMenu={onNodeContextMenu}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.35}
      maxZoom={1.45}
      nodeDragThreshold={1}
      onlyRenderVisibleElements
      snapToGrid={false}
      defaultEdgeOptions={{ type: 'elastic' }}
      edgesReconnectable
      reconnectRadius={18}
      deleteKeyCode={['Backspace', 'Delete']}
    >
      <Background color={theme === 'dark' ? '#2a3950' : '#e5eaf0'} gap={24} size={1} variant={BackgroundVariant.Lines} />
      {renderMiniMap && <MiniMap className="minimap" maskColor={theme === 'dark' ? 'rgba(15,23,42,.72)' : 'rgba(248,250,252,.72)'} nodeColor={(node) => miniMapColors[(node.data as PipelineNode['data']).kind]} pannable zoomable />}
      <Controls className="flow-controls" showInteractive={false} />
    </ReactFlow>
    </ElasticRoutingProvider>
    {contextMenu && <div className="card-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <div><small>CARD</small><strong>{contextMenu.label}</strong></div>
      <button className="context-edit" onClick={() => onEditCard(contextMenu.nodeId, contextMenu.label)} role="menuitem" type="button"><Pencil size={14} /><span><strong>Edit card</strong><small>Open metadata and rules</small></span></button>
      <button className="context-delete" onClick={() => onDeleteCard(contextMenu.nodeId)} role="menuitem" type="button"><Trash2 size={14} /><span><strong>Delete card</strong><small>Also removes attached edges</small></span></button>
    </div>}
  </section>
}
