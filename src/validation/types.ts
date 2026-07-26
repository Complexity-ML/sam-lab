import type { Edge } from '@xyflow/react'
import type { PipelineNode } from '../domain/pipeline'

export interface ValidationIssue {
  id: string
  atomId: string
  severity: 'error' | 'warning' | 'info'
  nodeId?: string
  title: string
  detail: string
}

export interface ValidationContext {
  nodes: PipelineNode[]
  edges: Edge[]
}

export interface ValidationAtom {
  id: string
  label: string
  run(context: ValidationContext): ValidationIssue[]
}
