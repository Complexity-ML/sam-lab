import type { Edge } from '@xyflow/react'
import type { PipelineNode } from './pipeline'

export interface GraphSnapshot { edges: Edge[]; nodes: PipelineNode[] }
export interface GraphHistory { entries: GraphSnapshot[]; index: number }

function fingerprint(snapshot: GraphSnapshot) {
  return JSON.stringify(snapshot)
}

function cloneSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data, schema: node.data.schema.map((field) => ({ ...field, tags: field.tags ? [...field.tags] : undefined })) } })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  }
}

export function createGraphHistory(snapshot: GraphSnapshot): GraphHistory {
  return { entries: [cloneSnapshot(snapshot)], index: 0 }
}

export function recordGraphSnapshot(history: GraphHistory, snapshot: GraphSnapshot, limit = 50): GraphHistory {
  if (fingerprint(history.entries[history.index]) === fingerprint(snapshot)) return history
  const entries = [...history.entries.slice(0, history.index + 1), cloneSnapshot(snapshot)].slice(-limit)
  return { entries, index: entries.length - 1 }
}

export function undoGraphHistory(history: GraphHistory) {
  if (history.index <= 0) return { history, snapshot: undefined }
  const next = { ...history, index: history.index - 1 }
  return { history: next, snapshot: cloneSnapshot(next.entries[next.index]) }
}

export function redoGraphHistory(history: GraphHistory) {
  if (history.index >= history.entries.length - 1) return { history, snapshot: undefined }
  const next = { ...history, index: history.index + 1 }
  return { history: next, snapshot: cloneSnapshot(next.entries[next.index]) }
}
