import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'
import type { ValidationIssue } from '../validation'
import type { DataHubEvidence } from './datahub'

export interface PipelineVersion {
  id: string
  label: string
  createdAt: string
  origin: 'initial' | 'agent' | 'manual'
  nodes: PipelineNode[]
  edges: Edge[]
  blockingIssues: number
  status?: 'committed' | 'pending-review' | 'rejected'
  description?: string
  evidence?: DataHubEvidence[]
}

export interface PipelineVersionProvenanceExport {
  revision: Pick<PipelineVersion, 'id' | 'label' | 'createdAt' | 'origin' | 'status' | 'description'>
  evidence: DataHubEvidence[]
}

function copyGraph<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeExportSummary(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
}

export function buildVersionProvenanceExport(version: PipelineVersion): PipelineVersionProvenanceExport {
  const { id, label, createdAt, origin, status, description } = version
  return {
    revision: { id, label, createdAt, origin, status, description },
    evidence: (version.evidence ?? []).map((item) => ({ ...item, summary: sanitizeExportSummary(item.summary) })),
  }
}

export function createPipelineVersion(nodes: PipelineNode[], edges: Edge[], label: string, origin: PipelineVersion['origin'], issues: ValidationIssue[]): PipelineVersion {
  return {
    id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    createdAt: new Date().toISOString(),
    origin,
    nodes: copyGraph(nodes),
    edges: copyGraph(edges),
    blockingIssues: issues.filter((issue) => issue.severity === 'error').length,
    status: 'committed',
  }
}

export function appendPipelineVersion(versions: PipelineVersion[], version: PipelineVersion, limit = 12): PipelineVersion[] {
  if (limit <= 0) return []
  const combined = [...versions, version]
  const bounded = combined.slice(-limit)
  const lastCommitted = [...combined].reverse().find((candidate) => (candidate.status ?? 'committed') === 'committed')
  if (!lastCommitted || bounded.some((candidate) => candidate.id === lastCommitted.id)) return bounded
  const replaceIndex = bounded.findIndex((candidate) => (candidate.status ?? 'committed') !== 'committed')
  if (replaceIndex < 0) return bounded
  return bounded.map((candidate, index) => index === replaceIndex ? lastCommitted : candidate)
}

function canonicalGraph(nodes: PipelineNode[], edges: Edge[]) {
  const semanticNodes = nodes.map((node) => ({
    kind: node.data.kind,
    label: node.data.label,
    description: node.data.description,
    owner: node.data.owner,
    rule: node.data.rule,
    connectorId: node.data.connectorId,
    assetRef: node.data.assetRef,
    datahubUrn: node.data.datahubUrn,
    schema: node.data.schema,
  }))
  const nodeSignatures = new Map(nodes.map((node, index) => [node.id, JSON.stringify(semanticNodes[index])]))
  const cleanNodes = semanticNodes.map((node) => JSON.stringify(node)).sort()
  const cleanEdges = edges.map((edge) => ({
    source: nodeSignatures.get(edge.source) ?? `missing:${edge.source}`,
    target: nodeSignatures.get(edge.target) ?? `missing:${edge.target}`,
    sourceHandle: edge.sourceHandle ?? null,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return JSON.stringify({ nodes: cleanNodes, edges: cleanEdges })
}

export function graphFingerprint(nodes: PipelineNode[], edges: Edge[]) {
  const canonical = canonicalGraph(nodes, edges)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function graphsEquivalent(leftNodes: PipelineNode[], leftEdges: Edge[], rightNodes: PipelineNode[], rightEdges: Edge[]) {
  return graphFingerprint(leftNodes, leftEdges) === graphFingerprint(rightNodes, rightEdges)
}

export function findEquivalentVersion(nodes: PipelineNode[], edges: Edge[], versions: PipelineVersion[]): PipelineVersion | undefined {
  const signature = canonicalGraph(nodes, edges)
  return [...versions].reverse().find((version) => canonicalGraph(version.nodes, version.edges) === signature)
}

export function commitPendingVersion(versions: PipelineVersion[], pendingVersionId: string | undefined, committed: PipelineVersion): PipelineVersion[] {
  if (!pendingVersionId) return appendPipelineVersion(versions, committed)
  return versions.map((candidate) => candidate.id === pendingVersionId
    ? { ...committed, id: candidate.id, createdAt: candidate.createdAt, description: candidate.description, evidence: candidate.evidence, status: 'committed' }
    : candidate)
}

export function rejectPendingVersion(versions: PipelineVersion[], pendingVersionId: string | undefined): PipelineVersion[] {
  if (!pendingVersionId) return versions
  return versions.map((candidate) => candidate.id === pendingVersionId
    ? { ...candidate, status: 'rejected' }
    : candidate)
}

export function resolveVersionSelection(
  versions: Array<Pick<PipelineVersion, 'id' | 'status'>>,
  requestedId?: string,
): string | undefined {
  if (requestedId && versions.some((version) => version.id === requestedId)) return requestedId
  return [...versions].reverse().find((version) => version.status === 'pending-review')?.id ?? versions.at(-1)?.id
}

export function restorePipelineVersion(version: PipelineVersion): { nodes: PipelineNode[]; edges: Edge[] } {
  return { nodes: copyGraph(version.nodes), edges: copyGraph(version.edges) }
}

export function readPipelineVersions(serialized: string | null): PipelineVersion[] {
  if (!serialized) return []
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PipelineVersion => Boolean(item)
      && typeof item === 'object'
      && typeof item.id === 'string'
      && typeof item.label === 'string'
      && Array.isArray(item.nodes)
      && Array.isArray(item.edges))
  } catch {
    return []
  }
}
