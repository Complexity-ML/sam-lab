import type { CardKind, PipelineNode } from '../domain/pipeline'
import { cardConnectionError } from '../domain/card-compatibility'
import { catalogExplorerPolicyError } from '../domain/catalog-explorer-policy'
import { isHostVerifiedAggregateDataProfile, isHostVerifiedMetadataOnlyProfile } from '../domain/data-profile'
import { parseQueryCheckRule, queryCheckRuleError } from '../domain/query-check'
import { parseRiskAssessmentRule } from '../domain/risk-assessment'
import { parseWorkerPolicy, workerPolicyError } from '../domain/worker-policy'
import type { ValidationAtom, ValidationContext, ValidationIssue } from './types'

function issue(atomId: string, value: Omit<ValidationIssue, 'atomId'>): ValidationIssue {
  return { atomId, ...value }
}

function containsCycle({ nodes, edges }: ValidationContext): boolean {
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback') adjacency.get(edge.source)?.push(edge.target)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const target of adjacency.get(nodeId) ?? []) if (visit(target)) return true
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  return nodes.some((node) => visit(node.id))
}

export const pipelinePresenceAtom: ValidationAtom = {
  id: 'pipeline-presence',
  label: 'Pipeline presence',
  run({ nodes }) {
    return nodes.length === 0
      ? [issue(this.id, {
          id: 'empty-pipeline',
          severity: 'error',
          title: 'Pipeline is empty',
          detail: 'Add at least one Asset Source card before running the SAM workflow.',
        })]
      : []
  },
}

export const pipelineTerminalsAtom: ValidationAtom = {
  id: 'pipeline-terminals',
  label: 'Required pipeline terminals',
  run({ nodes }) {
    if (nodes.length === 0) return []
    const hasLineageIntent = nodes.some((node) => node.data.kind !== 'control'
      && node.data.kind !== 'explorer'
      && !(node.data.kind === 'worker' && parseWorkerPolicy(node.data.rule).role === 'exploration'))
    if (!hasLineageIntent) return []
    const findings: ValidationIssue[] = []
    if (!nodes.some((node) => node.data.kind === 'source')) findings.push(issue(this.id, { id: 'missing-source', severity: 'error', title: 'Asset Source is required', detail: 'A runnable SAM workflow must start from at least one Asset Source card.' }))
    if (!nodes.some((node) => node.data.kind === 'output')) findings.push(issue(this.id, { id: 'missing-output', severity: 'error', title: 'Terminal Output is required', detail: 'A runnable pipeline must end at least one branch with an Output card.' }))
    return findings
  },
}

export const edgeIntegrityAtom: ValidationAtom = {
  id: 'edge-integrity',
  label: 'Edge integrity',
  run({ nodes, edges }) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return edges.flatMap((edge) => {
      const findings: ValidationIssue[] = []
      if (!byId.has(edge.source) || !byId.has(edge.target)) findings.push(issue(this.id, { id: `dangling-${edge.id}`, severity: 'error', title: 'Dangling connection', detail: `${edge.source} → ${edge.target} references a missing card.` }))
      if (edge.source === edge.target) findings.push(issue(this.id, { id: `self-${edge.id}`, severity: 'error', nodeId: edge.source, title: 'Invalid direction', detail: 'A card cannot send data to itself.' }))
      const sourceKind = byId.get(edge.source)?.data.kind
      const targetKind = byId.get(edge.target)?.data.kind
      const compatibilityError = sourceKind && targetKind ? cardConnectionError(sourceKind, targetKind, edge.sourceHandle) : undefined
      if (compatibilityError) findings.push(issue(this.id, {
        id: `compatibility-${edge.id}`,
        severity: 'error',
        nodeId: edge.source,
        title: 'Incompatible card connection',
        detail: compatibilityError,
      }))
      return findings
    })
  },
}

export const acyclicLineageAtom: ValidationAtom = {
  id: 'acyclic-lineage',
  label: 'Acyclic lineage',
  run(context) {
    return containsCycle(context) ? [issue(this.id, { id: 'cycle', severity: 'error', title: 'Circular lineage', detail: 'The pipeline contains a cycle, so lineage direction is ambiguous.' })] : []
  },
}

type CardContract = (context: ValidationContext, nodeId: string) => ValidationIssue[]

function hasUpstreamContextReader({ nodes, edges }: ValidationContext, nodeId: string, acceptedKinds = ['profile', 'analysis', 'impact', 'risk']): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback') incoming.get(edge.target)?.push(edge.source)
  const queue = [...(incoming.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) continue
    if (acceptedKinds.includes(current.data.kind)) return true
    queue.push(...(incoming.get(currentId) ?? []))
  }
  return false
}

function hasUpstreamAggregateDataEvidence({ nodes, edges }: ValidationContext, nodeId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback') incoming.get(edge.target)?.push(edge.source)
  const queue = [...(incoming.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) continue
    if (current.data.kind === 'profile' && isHostVerifiedAggregateDataProfile(current.data.profile)) return true
    queue.push(...(incoming.get(currentId) ?? []))
  }
  return false
}

function hasDownstreamKind({ nodes, edges }: ValidationContext, nodeId: string, acceptedKinds: CardKind[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) if (edge.sourceHandle !== 'feedback') outgoing.get(edge.source)?.push(edge.target)
  const queue = [...(outgoing.get(nodeId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) continue
    if (acceptedKinds.includes(current.data.kind)) return true
    queue.push(...(outgoing.get(currentId) ?? []))
  }
  return false
}

const cardContracts: Partial<Record<CardKind, CardContract>> = {
  control: ({ nodes, edges }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const findings: ValidationIssue[] = []
    if (nodes.filter((candidate) => candidate.data.kind === 'control').length > 1) findings.push(issue('card-contracts', {
      id: `control-duplicate-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Multiple SAM LAB controllers',
      detail: 'Keep exactly one SAM LAB Control card so the autonomous player has one persistent policy.',
    }))
    if (edges.some((edge) => edge.source === nodeId || edge.target === nodeId)) findings.push(issue('card-contracts', {
      id: `control-edge-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Control card is connected to data lineage',
      detail: 'SAM LAB Control configures the player globally and must remain outside the dataset lineage path.',
    }))
    if (node.data.controlMode !== 'autonomous-player'
      || !/objective=/i.test(node.data.rule ?? '')
      || !/on_review=/i.test(node.data.rule ?? '')
      || !/on_idle=/i.test(node.data.rule ?? '')) findings.push(issue('card-contracts', {
      id: `control-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Control policy is incomplete',
      detail: 'Declare objective, on_review and on_idle so Play, review resume and monitoring remain deterministic.',
    }))
    return findings
  },
  explorer: ({ nodes, edges }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const findings: ValidationIssue[] = []
    if (nodes.filter((candidate) => candidate.data.kind === 'explorer').length > 1) findings.push(issue('card-contracts', {
      id: `explorer-duplicate-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Multiple Catalog Explorers',
      detail: 'Keep one catalog-wide Explorer and create independent incident branches from its versioned checkpoints.',
    }))
    if (edges.some((edge) => edge.source === nodeId || edge.target === nodeId)) findings.push(issue('card-contracts', {
      id: `explorer-edge-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Catalog Explorer is connected to data lineage',
      detail: 'Catalog Explorer is a host-owned sidecar. It audits all sources and emits evidence, but never carries dataset rows.',
    }))
    const policyError = catalogExplorerPolicyError(node.data.rule)
    if (node.data.explorerMode !== 'catalog-fanout' || policyError) findings.push(issue('card-contracts', {
      id: `explorer-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Catalog exploration policy is incomplete',
      detail: policyError ?? 'Keep Catalog Explorer in its host-owned adjustable sidecar mode.',
    }))
    return findings
  },
  worker: ({ nodes }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const policyError = workerPolicyError(node.data.rule)
    if (node.data.workerMode !== 'bounded-execution' || policyError) return [issue('card-contracts', {
      id: `worker-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Worker policy is incomplete',
      detail: policyError ?? 'Worker Node must use bounded execution with branch-only context and atomic checkpoints.',
    })]
    return []
  },
  query: (context, nodeId) => {
    const node = context.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const policy = parseQueryCheckRule(node.data.rule)
    const policyError = queryCheckRuleError(node.data.rule)
    const findings: ValidationIssue[] = []
    if (policyError) findings.push(issue('card-contracts', {
      id: `query-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Query Check contract is incomplete',
      detail: policyError,
    }))
    const incoming = context.edges.filter((edge) => edge.target === nodeId && edge.sourceHandle !== 'feedback')
    const outgoing = context.edges.filter((edge) => edge.source === nodeId && edge.sourceHandle !== 'feedback')
    if (!incoming.length || !outgoing.length) findings.push(issue('card-contracts', {
      id: `query-path-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Query Check is not part of a complete path',
      detail: 'Place Query Check between an evidence-producing card and a card that consumes its verified contract.',
    }))
    if (policy.mode === 'governed_write' && !hasDownstreamKind(context, nodeId, ['review'])) findings.push(issue('card-contracts', {
      id: `query-write-review-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Governed query write lacks Human Review',
      detail: 'Every governed GraphQL write must reach a Human Review checkpoint before any mutation is executed.',
    }))
    if (policy.operation === 'profile.read' && !hasDownstreamKind(context, nodeId, ['profile'])) findings.push(issue('card-contracts', {
      id: `query-profile-output-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Aggregate query has no Data Profile',
      detail: 'Route profile.read into a Data Profile card so row counts, null rates, uniqueness, distributions and value-risk signals remain versioned and replayable.',
    }))
    return findings
  },
  source: ({ edges }, nodeId) => edges.some((edge) => edge.target === nodeId) ? [issue('card-contracts', { id: `source-input-${nodeId}`, severity: 'error', nodeId, title: 'Source has an input', detail: 'Asset Source cards must begin an evidence path.' })] : [],
  split: ({ edges }, nodeId) => {
    const outgoing = edges.filter((edge) => edge.source === nodeId)
    const handles = outgoing.map((edge) => edge.sourceHandle)
    const findings: ValidationIssue[] = []
    if (outgoing.length !== 2) findings.push(issue('card-contracts', { id: `split-branch-count-${nodeId}`, severity: 'error', nodeId, title: 'Invalid split branch count', detail: 'A Split must expose exactly one approved branch and one quarantine branch.' }))
    for (const handle of ['approved', 'quarantine']) {
      const count = handles.filter((candidate) => candidate === handle).length
      if (count !== 1) findings.push(issue('card-contracts', { id: `split-handle-${handle}-${nodeId}`, severity: 'error', nodeId, title: `Invalid ${handle} split handle`, detail: `Expected exactly one ${handle} connection, found ${count}.` }))
    }
    for (const edge of outgoing) if (!['approved', 'quarantine'].includes(edge.sourceHandle ?? '')) findings.push(issue('card-contracts', { id: `split-handle-unknown-${edge.id}`, severity: 'error', nodeId, title: 'Unknown split handle', detail: `${edge.id} must use the approved or quarantine source handle.` }))
    return findings
  },
  impact: (context, nodeId) => {
    if (hasDownstreamKind(context, nodeId, ['risk'])) return []
    return [issue('card-contracts', {
      id: `impact-risk-coverage-${nodeId}`,
      severity: 'warning',
      nodeId,
      title: 'Impact analysis has no risk classification',
      detail: 'Add an evidence-backed Risk Assessment downstream so domain, severity, confidence, affected assets and mitigation are explicit. The agent should propose this missing graph coverage.',
    })]
  },
  risk: (context, nodeId) => {
    const node = context.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const risk = parseRiskAssessmentRule(node.data.rule)
    const findings: ValidationIssue[] = []
    if (!risk.complete) findings.push(issue('card-contracts', {
      id: `risk-contract-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Risk context is incomplete',
      detail: 'Declare scope, risk_type, severity, confidence, evidence, affected_assets and action so this assessment is atomic and replayable.',
    }))
    if (!hasUpstreamContextReader(context, nodeId, ['profile', 'analysis', 'impact'])) findings.push(issue('card-contracts', {
      id: `risk-evidence-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Risk assessment lacks upstream evidence',
      detail: 'Place Data Profile, Data Analysis or Impact Analysis upstream before classifying data or ML risk.',
    }))
    if (risk.riskType === 'data' && risk.evidence !== 'fresh') findings.push(issue('card-contracts', {
      id: `risk-data-evidence-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Data risk lacks fresh evidence',
      detail: 'A dataset, feature or model risk may be asserted only from fresh versioned connector evidence. Use risk_type=collection for MCP or catalog-read failures.',
    }))
    if (risk.riskType === 'data' && ['data', 'ml', 'analytics'].includes(risk.domain) && !hasUpstreamAggregateDataEvidence(context, nodeId)) findings.push(issue('card-contracts', {
      id: `risk-aggregate-evidence-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Dataset value risk lacks an aggregate data audit',
      detail: 'Read a bounded aggregate profile with Query Check, preserve it in Data Profile, then classify null, duplicate, volume or distribution risk. Schema metadata alone cannot prove a value anomaly.',
    }))
    if (risk.riskType === 'data' && (risk.severity === 'unknown' || risk.affectedAssets === 0)) findings.push(issue('card-contracts', {
      id: `risk-data-impact-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Data risk has no concrete impact',
      detail: 'Name a supported severity and at least one affected asset before treating this as a data or ML incident.',
    }))
    if (risk.riskType === 'collection' && risk.affectedAssets !== undefined && risk.affectedAssets > 0) findings.push(issue('card-contracts', {
      id: `risk-collection-impact-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Collection failure is presented as data impact',
      detail: 'Connector reliability can block analysis but cannot claim affected datasets, features or models without fresh evidence.',
    }))
    if (risk.riskType === 'none' && (risk.affectedAssets !== 0 || !['unknown', 'low'].includes(risk.severity ?? ''))) findings.push(issue('card-contracts', {
      id: `risk-none-impact-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'No-risk assessment contains an impact claim',
      detail: 'risk_type=none must keep affected_assets=0 and severity unknown or low.',
    }))
    if (risk.domain === 'ml' && risk.riskType === 'data' && risk.affectedModels === undefined) findings.push(issue('card-contracts', {
      id: `risk-ml-models-${nodeId}`,
      severity: 'warning',
      nodeId,
      title: 'ML risk does not quantify affected models',
      detail: 'Declare affected_models when fresh lineage identifies model, feature or deployment impact. Keep it unknown when the evidence does not support a count.',
    }))
    if (['critical', 'high'].includes(risk.severity ?? '') && !hasDownstreamKind(context, nodeId, ['patch', 'decision', 'review', 'validation'])) findings.push(issue('card-contracts', {
      id: `risk-mitigation-${nodeId}`,
      severity: 'warning',
      nodeId,
      title: 'Elevated risk has no mitigation path',
      detail: 'Propose a graph-only Compatibility Patch, Agent Decision, Human Review or Validation checkpoint downstream before publishing an affected Output.',
    }))
    return findings
  },
  patch: (context, nodeId) => {
    const node = context.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const findings: ValidationIssue[] = []
    if (node.data.patchScope !== 'graph-only') findings.push(issue('card-contracts', {
      id: `patch-scope-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Patch scope is unsafe',
      detail: 'A Compatibility Patch must be graph-only and must never mutate the source DataHub dataset.',
    }))
    if (!/^graph[_ -]?only\s*:/i.test(node.data.rule?.trim() ?? '')) findings.push(issue('card-contracts', {
      id: `patch-rule-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Patch rule is not explicit',
      detail: 'Declare a deterministic rule beginning with “graph_only:” so the compatibility overlay is replayable and reversible.',
    }))
    if (!hasUpstreamContextReader(context, nodeId, ['profile', 'analysis', 'impact', 'risk', 'query'])) findings.push(issue('card-contracts', {
      id: `patch-evidence-${nodeId}`,
      severity: 'warning',
      nodeId,
      title: 'Patch lacks upstream context evidence',
      detail: 'Place Data Profile, Data Analysis, Impact Analysis or Risk Assessment upstream so the patch is based on a complete versioned metadata reading.',
    }))
    return findings
  },
  monitor: ({ nodes, edges }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const findings: ValidationIssue[] = []
    if (node.data.monitorMode !== 'event-loop') findings.push(issue('card-contracts', {
      id: `monitor-mode-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Monitor mode is unsafe',
      detail: 'Live Monitor must open a new bounded iteration instead of creating an in-run cycle.',
    }))
    if (!/on_change\(metadata_fingerprint\)/i.test(node.data.rule ?? '')
      || !/cooldown\s*=\s*\d+\s*(?:s|m|h)?\b/i.test(node.data.rule ?? '')
      || !/max_iterations=\d+/i.test(node.data.rule ?? '')) findings.push(issue('card-contracts', {
      id: `monitor-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Monitor policy is incomplete',
      detail: 'Declare metadata fingerprint, cooldown and max_iterations so repeated agent runs remain bounded.',
    }))
    if (!edges.some((edge) => edge.source === nodeId && edge.sourceHandle !== 'feedback')) findings.push(issue('card-contracts', {
      id: `monitor-output-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Monitor has no work branch',
      detail: 'Connect Live Monitor to the first card of the bounded iteration.',
    }))
    return findings
  },
  parallel: ({ nodes, edges }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const outgoing = edges.filter((edge) => edge.source === nodeId && edge.sourceHandle !== 'feedback')
    const findings: ValidationIssue[] = []
    if (node.data.parallelMode !== 'branch-fanout') findings.push(issue('card-contracts', {
      id: `parallel-mode-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Parallel agent mode is unsafe',
      detail: 'Parallel Agents must isolate each branch and merge only reviewed diffs.',
    }))
    if (outgoing.length < 2) findings.push(issue('card-contracts', {
      id: `parallel-branch-count-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Parallel work needs independent branches',
      detail: 'Connect at least two downstream branches before launching parallel agents.',
    }))
    if (!/max_concurrency=\d+/i.test(node.data.rule ?? '')
      || !/context=branch_only/i.test(node.data.rule ?? '')
      || !/merge=atomic/i.test(node.data.rule ?? '')) findings.push(issue('card-contracts', {
      id: `parallel-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Parallel policy is incomplete',
      detail: 'Declare max_concurrency, branch-only context and atomic merge. Token usage is observed but not capped.',
    }))
    return findings
  },
  diagram: ({ nodes, edges }, nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return []
    const incoming = edges.filter((edge) => edge.target === nodeId && edge.sourceHandle !== 'feedback')
    const findings: ValidationIssue[] = []
    if (node.data.diagramMode !== 'incident-workstream') findings.push(issue('card-contracts', {
      id: `diagram-mode-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Incident Diagram mode is invalid',
      detail: 'Incident Diagram must relate branch results without mutating their evidence or source data.',
    }))
    if (incoming.length < 2) findings.push(issue('card-contracts', {
      id: `diagram-input-count-${nodeId}`,
      severity: 'warning',
      nodeId,
      title: 'Incident Diagram has fewer than two branches',
      detail: 'Connect parallel incident branches here to compare and merge their reviewed diffs.',
    }))
    if (!/group=incident/i.test(node.data.rule ?? '')
      || !/inputs=parallel_diffs/i.test(node.data.rule ?? '')
      || !/merge=atomic/i.test(node.data.rule ?? '')) findings.push(issue('card-contracts', {
      id: `diagram-policy-${nodeId}`,
      severity: 'error',
      nodeId,
      title: 'Incident Diagram merge policy is incomplete',
      detail: 'Declare incident grouping, parallel diff inputs and atomic merge.',
    }))
    return findings
  },
  review: ({ edges }, nodeId) => edges.some((edge) => edge.target === nodeId) && edges.some((edge) => edge.source === nodeId) ? [] : [issue('card-contracts', { id: `review-path-${nodeId}`, severity: 'warning', nodeId, title: 'Review is not gating a path', detail: 'A Human Review card must have an input and an output.' })],
  output: ({ nodes, edges }, nodeId) => edges.some((edge) => edge.source === nodeId && (edge.sourceHandle !== 'feedback' || nodes.find((candidate) => candidate.id === edge.target)?.data.kind !== 'monitor'))
    ? [issue('card-contracts', { id: `output-edge-${nodeId}`, severity: 'error', nodeId, title: 'Output has an invalid downstream edge', detail: 'Output may only emit a feedback edge to Live Monitor for the next atomic iteration.' })]
    : [],
}

export const cardContractsAtom: ValidationAtom = {
  id: 'card-contracts',
  label: 'Atomic card contracts',
  run(context) {
    return context.nodes.flatMap((node) => {
      if (node.data.kind === 'profile') return []
      const findings: ValidationIssue[] = []
      const globalSystemCard = node.data.kind === 'control'
        || node.data.kind === 'explorer'
        || (node.data.kind === 'worker' && parseWorkerPolicy(node.data.rule).role === 'exploration')
      if (!globalSystemCard && node.data.kind !== 'source' && node.data.kind !== 'monitor' && !context.edges.some((edge) => edge.target === node.id && edge.sourceHandle !== 'feedback')) findings.push(issue(this.id, { id: `orphan-input-${node.id}`, severity: 'error', nodeId: node.id, title: 'Orphan card', detail: `${node.data.label} does not receive data.` }))
      if (!globalSystemCard && node.data.kind !== 'output' && node.data.kind !== 'review' && !context.edges.some((edge) => edge.source === node.id && edge.sourceHandle !== 'feedback')) findings.push(issue(this.id, { id: `orphan-output-${node.id}`, severity: 'error', nodeId: node.id, title: 'Dead-end card', detail: `${node.data.label} does not lead to another card or terminal output.` }))
      return [...findings, ...(cardContracts[node.data.kind]?.(context, node.id) ?? [])]
    })
  },
}

export const schemaContractAtom: ValidationAtom = {
  id: 'schema-contract',
  label: 'Declared schema contracts',
  run({ nodes, edges }) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
    for (const edge of edges) if (edge.sourceHandle !== 'feedback') incoming.get(edge.target)?.push(edge.source)
    return nodes.flatMap((contract) => {
      if (contract.data.kind !== 'validation') return []
      const declaration = contract.data.rule?.match(/schema_contract\s*:\s*(.+)/i)?.[1]
      if (!declaration) return []
      const expected = declaration.split(',').flatMap((entry) => {
        const [name, type] = entry.trim().split(':').map((value) => value.trim())
        return name && ['string', 'number', 'boolean', 'timestamp'].includes(type) ? [{ name, type }] : []
      })
      const queue = [...(incoming.get(contract.id) ?? [])]
      const visited = new Set<string>()
      let upstream = undefined as PipelineNode | undefined
      while (queue.length && !upstream) {
        const id = queue.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const candidate = byId.get(id)
        if (!candidate) continue
        if (candidate.data.schema.length) upstream = candidate
        else queue.push(...(incoming.get(id) ?? []))
      }
      if (!upstream) return [issue(this.id, { id: `schema-contract-unavailable-${contract.id}`, severity: 'warning', nodeId: contract.id, title: 'Schema contract cannot be evaluated', detail: 'No upstream card exposes a schema for this declared contract.' })]
      return expected.flatMap((field) => {
        const actual = upstream!.data.schema.find((candidate) => candidate.name === field.name)
        if (!actual) return [issue(this.id, { id: `schema-contract-missing-${contract.id}-${field.name}`, severity: 'error', nodeId: contract.id, title: `Required field ${field.name} is missing`, detail: `${contract.data.label} expects ${field.name}:${field.type}, but ${upstream!.data.label} does not expose that field.` })]
        return actual.type !== field.type ? [issue(this.id, { id: `schema-contract-type-${contract.id}-${field.name}`, severity: 'error', nodeId: contract.id, title: `Breaking type drift on ${field.name}`, detail: `${contract.data.label} expects ${field.name}:${field.type}, but ${upstream!.data.label} exposes ${field.name}:${actual.type}.` })] : []
      })
    })
  },
}

export const sensitiveDataAtom: ValidationAtom = {
  id: 'sensitive-data-path',
  label: 'Sensitive data propagation',
  run({ nodes, edges }) {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
    for (const edge of edges) if (edge.sourceHandle !== 'feedback') outgoing.get(edge.source)?.push(edge.target)
    const sensitiveSources = nodes.filter((node) => node.data.kind === 'source' && (node.data.datahubTags?.some((tag) => /pii|sensitive|personal|gdpr/i.test(tag)) || node.data.schema.some((field) => field.tags?.some((tag) => /pii|sensitive|personal|gdpr/i.test(tag)))))
    const unsafeOutputs = new Map<string, string>()
    for (const source of sensitiveSources) {
      const sourceRef = source.data.datahubUrn ?? source.data.assetRef
      const queue = [{ id: source.id, protected: false, metadataOnly: false }]
      const visited = new Set<string>()
      while (queue.length) {
        const current = queue.shift()!
        const node = byId.get(current.id)
        if (!node) continue
        const protectedPath = current.protected || (node.data.kind === 'transform' && /mask|hash|sha(?:-?\d+)?|tokeni[sz]e|redact|encrypt/i.test(`${node.data.label} ${node.data.rule ?? ''}`))
        const metadataOnlyPath = current.metadataOnly || (node.data.kind === 'profile'
          && Boolean(sourceRef)
          && isHostVerifiedMetadataOnlyProfile(node.data.profile)
          && node.data.profile.sourceUrn === sourceRef)
        const stateKey = `${node.id}:${protectedPath}:${metadataOnlyPath}`
        if (visited.has(stateKey)) continue
        visited.add(stateKey)
        const governedRestrictedSink = node.data.kind === 'output' && /quarantine|secure|vault|restricted|steward|hold/i.test(`${node.data.label} ${node.data.description} ${node.data.assetRef ?? node.data.datahubUrn ?? ''}`)
        if (node.data.kind === 'output' && !protectedPath && !metadataOnlyPath && !governedRestrictedSink) unsafeOutputs.set(node.id, source.id)
        for (const target of outgoing.get(node.id) ?? []) queue.push({ id: target, protected: protectedPath, metadataOnly: metadataOnlyPath })
      }
    }
    return [...unsafeOutputs].map(([outputId, sourceId]) => issue(this.id, { id: `sensitive-unprotected-${sourceId}-${outputId}`, severity: 'error', nodeId: outputId, title: 'Sensitive data reaches an output unprotected', detail: `${byId.get(sourceId)?.data.label ?? sourceId} reaches ${byId.get(outputId)?.data.label ?? outputId} without a masking, hashing, tokenization, redaction or encryption transform on that path.` }))
  },
}

export const dataHubGovernanceAtom: ValidationAtom = {
  id: 'datahub-governance',
  label: 'DataHub governance signals',
  run({ nodes }) {
    return nodes.flatMap((node) => {
      if (!(node.data.assetRef || node.data.datahubUrn)) return []
      const findings: ValidationIssue[] = []
      const sensitive = node.data.datahubTags?.some((tag) => /pii|sensitive|gdpr|personal/i.test(tag))
        || node.data.schema.some((field) => field.tags?.some((tag) => /pii|sensitive|gdpr|personal/i.test(tag)))
      if (!node.data.owner.trim() || node.data.owner === 'Unassigned') findings.push(issue(this.id, { id: `missing-owner-${node.id}`, severity: 'error', nodeId: node.id, title: 'DataHub ownership is missing', detail: 'Publishing is blocked because the bound asset has no accountable owner.' }))
      if (node.data.datahubQuality === 'failing') findings.push(issue(this.id, { id: `quality-failing-${node.id}`, severity: 'error', nodeId: node.id, title: 'Catalog quality checks are failing', detail: 'Publishing is blocked until failing catalog assertions are resolved or explicitly reviewed.' }))
      if (node.data.datahubQuality === 'unavailable') findings.push(issue(this.id, { id: `quality-unavailable-${node.id}`, severity: 'warning', nodeId: node.id, title: 'Data quality metadata is unavailable', detail: 'Unavailable quality metadata is not treated as a healthy signal.' }))
      if (node.data.datahubFreshness?.stale) findings.push(issue(this.id, { id: `metadata-stale-${node.id}`, severity: sensitive ? 'error' : 'warning', nodeId: node.id, title: 'Catalog evidence is stale', detail: sensitive ? 'Sensitive-data evidence expired, so the agent cannot proceed until connector context is refreshed.' : 'Refresh catalog context before relying on this metadata.' }))
      return findings
    })
  },
}
