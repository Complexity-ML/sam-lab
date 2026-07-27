import type { Edge, Node } from '@xyflow/react'
import type { DataHubEvidence } from './datahub'
import { scenarioPresets } from './presets'
import { defaultRiskAssessmentRule } from './risk-assessment'
import { defaultQueryCheckRule } from './query-check'
import { workerPolicyRule, defaultWorkerPolicy } from './worker-policy'
import type { DataValueRiskSignal, LineageAssetSummary } from './catalog-connectors'
import type { SoftwareAsset } from './sam'

export type CardKind = 'control' | 'explorer' | 'worker' | 'query' | 'source' | 'profile' | 'analysis' | 'impact' | 'risk' | 'patch' | 'monitor' | 'parallel' | 'diagram' | 'split' | 'decision' | 'transform' | 'review' | 'validation' | 'output'
export type PipelineStatus = 'healthy' | 'warning' | 'blocked' | 'draft'

export interface SchemaField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'timestamp'
  tags?: string[]
}

export interface DataProfileField extends SchemaField {
  nullRate?: number
  distinctCount?: number
}

export interface DataProfileStorageProof {
  kind: 'bounded-metadata'
  version: 1
  rawRowsStored: false
  hostVerified: boolean
}

export interface DatasetAggregateAudit {
  kind: 'bounded-aggregate-profile'
  version: 1
  status: 'complete' | 'coverage_gap' | 'unavailable'
  capturedAt: string
  previousCapturedAt?: string
  rowCount?: number
  previousRowCount?: number
  profiledFieldCount: number
  riskSignals: DataValueRiskSignal[]
  rawRowsRead: false
  hostVerified: boolean
}

export interface DataProfileSnapshot {
  connectorId?: string
  sourceSystem?: string
  assetRef?: string
  sourceUrn: string
  capturedAt: string
  expiresAt: string
  stale: boolean
  platform: string
  environment: string
  quality: 'healthy' | 'failing' | 'unavailable'
  fieldCount: number
  profiledFields: DataProfileField[]
  sensitiveFieldCount: number
  upstreamCount: number
  downstreamCount: number
  anomalies: string[]
  aggregateAudit: DatasetAggregateAudit
  tokenEstimate: number
  storage: DataProfileStorageProof
}

export interface CatalogExplorationProgress {
  query: string
  total: number
  discovered: number
  inspected: number
  /** Datasets whose aggregate value profile was actually read. */
  dataAudited?: number
  /** Datasets checked successfully but lacking an aggregate value profile. */
  dataAuditCoverageGaps?: number
  /** Datasets that still need their aggregate audit attempt or a bounded retry. */
  dataAuditRemaining?: number
  failed: number
  incidents: number
  governanceGaps: number
  concurrency: number
  batchSize?: number
  batchDurationMs?: number
  batchFailed?: number
  batchProcessed?: number
  batchCached?: number
  connectorRecoveryStreak?: number
  connectorRetryCount?: number
  connectorRetryLimit?: number
  connectorFailureFingerprint?: string
  nextRetryAt?: string
  remaining?: number
  mode?: 'dataset' | 'catalog'
  cacheMode?: 'prefer' | 'refresh'
  phase?: 'discover' | 'inspect' | 'checkpoint'
  state: 'idle' | 'discovering' | 'inspecting' | 'complete' | 'paused' | 'failed'
  pauseReason?: 'cancelled' | 'connector_unavailable' | 'retry_exhausted'
  checkpointAt: string
  datasets: CatalogDatasetCheckpoint[]
}

export interface CatalogDatasetCheckpoint {
  connectorId?: string
  sourceSystem?: string
  assetRef?: string
  urn: string
  name: string
  status: 'healthy' | 'warning' | 'unavailable'
  fieldCount: number
  sensitiveSignalCount?: number
  qualityStatus?: 'healthy' | 'failing' | 'unavailable'
  dataProfileStatus?: 'available' | 'unavailable' | 'error'
  /**
   * Host-owned proof that this dataset passed through the aggregate data-audit
   * stage. Legacy checkpoints intentionally omit it and are audited once.
   */
  dataAuditStatus?: 'complete' | 'coverage_gap' | 'unavailable'
  dataAuditedAt?: string
  dataRiskSignals?: DataValueRiskSignal[]
  ownerCount: number
  upstreamCount: number
  downstreamCount: number
  downstreamMlCount?: number
  downstreamMlRefs?: { urn: string; name: string; kind: 'feature' | 'model' | 'deployment' }[]
  issues: string[]
  fingerprint: string
  capturedAt: string
  expiresAt: string
  attemptCount?: number
  lastAttemptAt?: string
}

export interface PipelineNodeData extends Record<string, unknown> {
  kind: CardKind
  label: string
  description: string
  owner: string
  status: PipelineStatus
  schema: SchemaField[]
  connectorId?: string
  sourceSystem?: string
  assetRef?: string
  datahubUrn?: string
  datahubPlatform?: string
  datahubEnvironment?: string
  datahubDomain?: string
  datahubTags?: string[]
  datahubQuality?: 'healthy' | 'failing' | 'unavailable'
  datahubFreshness?: { capturedAt: string; expiresAt: string; stale: boolean }
  datahubUpstream?: LineageAssetSummary[]
  datahubDownstream?: LineageAssetSummary[]
  samAsset?: SoftwareAsset
  profile?: DataProfileSnapshot
  exploration?: CatalogExplorationProgress
  patchScope?: 'graph-only'
  monitorMode?: 'event-loop'
  parallelMode?: 'branch-fanout'
  diagramMode?: 'incident-workstream'
  controlMode?: 'autonomous-player'
  explorerMode?: 'catalog-fanout'
  workerMode?: 'bounded-execution'
  rule?: string
  agentAdded?: boolean
  pinned?: boolean
  runState?: 'idle' | 'running' | 'completed' | 'waiting' | 'failed' | 'stopped'
  runSequence?: number
  /**
   * Host-owned execution checkpoint. It fingerprints the card contract and
   * every non-feedback predecessor so unchanged cards are not replayed while
   * edited cards and their descendants are invalidated automatically.
   */
  runFingerprint?: string
}

export type PipelineNode = Node<PipelineNodeData, 'pipeline'>

export interface AgentRunTraceStep {
  nodeId: string
  label: string
  role: string
  state: 'completed' | 'waiting' | 'failed' | 'stopped'
  summary: string
}

export interface AgentProposal {
  id: string
  incidentKey?: string
  title: string
  summary: string
  rationale: string
  addedNodes: PipelineNode[]
  updatedNodes: { nodeId: string; patch: Partial<PipelineNodeData>; reason: string }[]
  addedEdges: Edge[]
  removedEdgeIds: string[]
  datahubReads: string[]
  evidence?: DataHubEvidence[]
  writeback: string
  requiresHumanReview?: boolean
  confidence?: number
  model?: string
  runTrace?: AgentRunTraceStep[]
  toolTrace?: { tool: string; status: 'read' | 'accepted' | 'rejected'; summary: string }[]
}

export const cardLabels: Record<CardKind, string> = {
  control: 'SAM Controller',
  explorer: 'Inventory Explorer',
  worker: 'Audit Worker',
  query: 'License Matching',
  source: 'Asset Source',
  profile: 'Asset Normalization',
  analysis: 'Usage Analysis',
  impact: 'Cost Impact',
  risk: 'Compliance Risk',
  patch: 'Optimization Patch',
  monitor: 'Inventory Monitor',
  parallel: 'Parallel Agents',
  diagram: 'Portfolio Diagram',
  split: 'Decision Split',
  decision: 'SAM Decision',
  transform: 'Normalize Assets',
  review: 'Human Review',
  validation: 'Compliance Check',
  output: 'SAM Report',
}

export const customerActivationNodes: PipelineNode[] = [
  {
    id: 'customers-source',
    type: 'pipeline',
    position: { x: 30, y: 190 },
    data: {
      kind: 'source',
      label: 'Customers 360',
      description: 'Curated customer table from Snowflake',
      owner: 'Growth Data',
      status: 'healthy',
      datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.order_entry.customers,PROD)',
      schema: [
        { name: 'customer_id', type: 'string' },
        { name: 'email', type: 'string', tags: ['PII'] },
        { name: 'country', type: 'string' },
        { name: 'lifetime_value', type: 'number' },
      ],
    },
  },
  {
    id: 'schema-analysis',
    type: 'pipeline',
    position: { x: 340, y: 190 },
    data: {
      kind: 'analysis',
      label: 'Analyze data context',
      description: 'Reads schema, tags, quality and downstream lineage from DataHub',
      owner: 'SAM LAB Agent',
      status: 'healthy',
      schema: [],
      rule: 'schema + tags + ownership + quality + lineage',
    },
  },
  {
    id: 'region-split',
    type: 'pipeline',
    position: { x: 650, y: 190 },
    data: {
      kind: 'split',
      label: 'Route by consent',
      description: 'Separates activation-ready rows from quarantine',
      owner: 'Growth Data',
      status: 'healthy',
      schema: [],
      rule: 'marketing_consent = true',
    },
  },
  {
    id: 'normalize-customer',
    type: 'pipeline',
    position: { x: 960, y: 70 },
    data: {
      kind: 'transform',
      label: 'Normalize profile',
      description: 'Normalizes country codes and customer identifiers',
      owner: 'Analytics Engineering',
      status: 'warning',
      schema: [],
      rule: 'upper(country), trim(customer_id)',
    },
  },
  {
    id: 'agent-decision',
    type: 'pipeline',
    position: { x: 1270, y: 70 },
    data: {
      kind: 'decision',
      label: 'Agent decision',
      description: 'The agent chooses a correction or requests human review from the analysis findings',
      owner: 'SAM LAB Agent',
      status: 'draft',
      schema: [],
      rule: 'Awaiting an agent correction plan',
    },
  },
  {
    id: 'consent-validation',
    type: 'pipeline',
    position: { x: 1580, y: 70 },
    data: {
      kind: 'validation',
      label: 'Governance gate',
      description: 'Validates consent and PII handling rules',
      owner: 'Data Governance',
      status: 'warning',
      schema: [],
      rule: 'PII fields must be masked before activation',
    },
  },
  {
    id: 'activation-output',
    type: 'pipeline',
    position: { x: 1890, y: 70 },
    data: {
      kind: 'output',
      label: 'CRM activation',
      description: 'Audience sync consumed by the CRM platform',
      owner: 'Lifecycle Marketing',
      status: 'blocked',
      datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,activation.crm_customers,PROD)',
      schema: [],
    },
  },
  {
    id: 'quarantine-output',
    type: 'pipeline',
    position: { x: 960, y: 330 },
    data: {
      kind: 'output',
      label: 'Consent quarantine',
      description: 'Rows held for data steward review',
      owner: 'Data Governance',
      status: 'healthy',
      datahubUrn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,governance.consent_quarantine,PROD)',
      schema: [],
    },
  },
]

export const customerActivationEdges: Edge[] = [
  { id: 'e-source-analysis', source: 'customers-source', target: 'schema-analysis', type: 'elastic' },
  { id: 'e-analysis-split', source: 'schema-analysis', target: 'region-split', type: 'elastic' },
  { id: 'e-split-normalize', source: 'region-split', target: 'normalize-customer', sourceHandle: 'approved', type: 'elastic', label: 'approved' },
  { id: 'e-split-quarantine', source: 'region-split', target: 'quarantine-output', sourceHandle: 'quarantine', type: 'elastic', label: 'quarantine' },
  { id: 'e-normalize-decision', source: 'normalize-customer', target: 'agent-decision', type: 'elastic' },
  { id: 'e-decision-validation', source: 'agent-decision', target: 'consent-validation', type: 'elastic' },
  { id: 'e-validation-output', source: 'consent-validation', target: 'activation-output', type: 'elastic' },
]

export const initialNodes: PipelineNode[] = []
export const initialEdges: Edge[] = []

export type PipelinePresetId = 'empty' | 'customer-activation' | 'pii-masking' | 'schema-drift' | 'broken-governance' | 'sam-evidence-gap' | 'license-reclamation' | 'compliance-exposure' | 'renewal-optimization'

export function loadPipelinePreset(preset: PipelinePresetId): { title: string; nodes: PipelineNode[]; edges: Edge[] } {
  if (preset === 'empty') return { title: 'Untitled pipeline', nodes: [], edges: [] }
  const selected = preset === 'customer-activation'
    ? { title: 'Customer activation', nodes: customerActivationNodes, edges: customerActivationEdges }
    : scenarioPresets[preset]
  return {
    title: selected.title,
    nodes: selected.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data, schema: node.data.schema.map((field) => ({ ...field, tags: field.tags ? [...field.tags] : undefined })) },
    })),
    edges: selected.edges.map((edge) => ({ ...edge })),
  }
}

export function applyProposal(nodes: PipelineNode[], edges: Edge[], proposal: AgentProposal): { nodes: PipelineNode[]; edges: Edge[] } {
  const removed = new Set(proposal.removedEdgeIds)
  const updates = new Map(proposal.updatedNodes.map((update) => [update.nodeId, update.patch]))
  const updated = nodes.map((node) => {
    const patch = updates.get(node.id)
    return patch ? { ...node, data: { ...node.data, ...patch, status: 'healthy' as const, agentAdded: false } } : node
  })
  const nextEdges = [...edges.filter((edge) => !removed.has(edge.id) && !proposal.addedEdges.some((added) => added.id === edge.id)), ...proposal.addedEdges]
  const nextNodes = [...updated.filter((node) => !proposal.addedNodes.some((added) => added.id === node.id)), ...proposal.addedNodes.map((node) => ({ ...node, data: { ...node.data, status: 'healthy' as const, agentAdded: false } }))]
  return prunePipelineGraph(nextNodes, nextEdges, proposal.addedNodes.map((node) => node.id))
}

const hostStarterKinds = new Set<CardKind>(['control', 'explorer', 'worker'])
const floatingEvidenceKinds = new Set<CardKind>(['source', 'profile'])

function orphanIdentity(node: PipelineNode) {
  // DataHub URNs and provider labels are not consistently cased. Treat a
  // casing-only variation as the same visual card so agent repairs cannot
  // leave duplicate profile sidecars on one canvas.
  const asset = (node.data.assetRef ?? node.data.datahubUrn)?.trim().toLowerCase()
  return asset ? `${node.data.kind}:${asset}` : `${node.data.kind}:${node.data.label.trim().toLowerCase()}`
}

/**
 * Host starters and bounded Source/Profile evidence may float between
 * incremental iterations. A disconnected evidence card becomes
 * reconstruction debris only when it duplicates a connected card identity or
 * occupies the same canvas slot as one.
 */
export function pruneOrphanedCards(nodes: PipelineNode[], edges: Edge[], strictNodeIds: Iterable<string> = []): PipelineNode[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  const connected = new Set(validEdges.flatMap((edge) => [edge.source, edge.target]))
  const strict = new Set(strictNodeIds)
  const connectedNodes = nodes.filter((node) => connected.has(node.id))
  const connectedIdentities = new Set(connectedNodes.map(orphanIdentity))
  const overlapsConnectedCard = (node: PipelineNode) => connectedNodes.some((candidate) => (
    candidate.id !== node.id
    && Math.abs(candidate.position.x - node.position.x) <= 4
    && Math.abs(candidate.position.y - node.position.y) <= 4
  ))
  return nodes.filter((node) => {
    if (hostStarterKinds.has(node.data.kind) || connected.has(node.id)) return true
    // A disconnected copy of an already connected card is always visual
    // debris, including profile memories left behind by an agent repair.
    if (connectedIdentities.has(orphanIdentity(node))) return false
    // Persisted repair diffs can retain an older profile at the exact XY slot
    // later assigned to its replacement. Although hidden under the visible
    // card, React Flow still routes elastic edges around that stale obstacle.
    if (floatingEvidenceKinds.has(node.data.kind) && overlapsConnectedCard(node)) return false
    if (floatingEvidenceKinds.has(node.data.kind)) return true
    // Every card created by the current transaction must join a branch.
    if (strict.has(node.id)) return false
    return true
  })
}

/**
 * Normalizes a persisted or proposed graph as one atomic unit. Removing the
 * orphan cards and their dangling edges together keeps React Flow obstacle
 * routing aligned with the cards that are actually visible.
 */
export function prunePipelineGraph(nodes: PipelineNode[], edges: Edge[], strictNodeIds: Iterable<string> = []): { nodes: PipelineNode[]; edges: Edge[] } {
  const prunedNodes = pruneOrphanedCards(nodes, edges, strictNodeIds)
  const keptNodeIds = new Set(prunedNodes.map((node) => node.id))
  return {
    nodes: prunedNodes,
    edges: edges.filter((edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target)),
  }
}

export function newCard(kind: CardKind, index: number): PipelineNode {
  const id = `${kind}-${Date.now()}-${index}`
  return {
    id,
    type: 'pipeline',
    position: { x: 120 + (index % 3) * 290, y: 120 + Math.floor(index / 3) * 190 },
    data: {
      kind,
      label: `New ${cardLabels[kind]}`,
      description: 'Configure this card in the inspector.',
      owner: 'Unassigned',
      status: 'draft',
      schema: [],
      rule: kind === 'split'
        ? 'condition = true'
        : kind === 'impact'
          ? 'scope(change) → DataHub lineage → ranked risks → recommended actions'
          : kind === 'risk'
            ? defaultRiskAssessmentRule
          : kind === 'patch'
            ? 'graph_only: map incompatible fields without mutating the source dataset'
            : kind === 'monitor'
              ? 'on_change(metadata_fingerprint) | cooldown=60s | max_iterations=10 | alert=severity_increase'
              : kind === 'parallel'
                ? 'max_concurrency=3 | context=branch_only | merge=atomic'
                : kind === 'diagram'
                  ? 'group=incident | inputs=parallel_diffs | merge=atomic'
                  : kind === 'control'
                    ? 'objective=maintain governed graph | mode=autonomous | on_review=checkpoint_and_resume | on_idle=monitor'
                    : kind === 'explorer'
                      ? 'scope=all_datasets | batch_size=8 | audit_concurrency=4 | cache=prefer | checkpoint=versioned | resume=true'
                      : kind === 'worker'
                        ? workerPolicyRule(defaultWorkerPolicy)
                        : kind === 'query'
                          ? defaultQueryCheckRule
            : undefined,
      patchScope: kind === 'patch' ? 'graph-only' : undefined,
      monitorMode: kind === 'monitor' ? 'event-loop' : undefined,
      parallelMode: kind === 'parallel' ? 'branch-fanout' : undefined,
      diagramMode: kind === 'diagram' ? 'incident-workstream' : undefined,
      controlMode: kind === 'control' ? 'autonomous-player' : undefined,
      explorerMode: kind === 'explorer' ? 'catalog-fanout' : undefined,
      workerMode: kind === 'worker' ? 'bounded-execution' : undefined,
    },
  }
}
