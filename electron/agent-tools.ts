import { proposalCardCompatibility, queryCheckRuleError, riskAssessmentRuleError, validateProposal, workerPolicyError, type ProposalCardKind, type ValidatedProposal, type ValidatedProposalAction } from './proposal-contract.js'

type JsonRecord = Record<string, unknown>
type ToolStatus = 'read' | 'accepted' | 'rejected'

export interface AgentToolTrace {
  tool: string
  status: ToolStatus
  summary: string
}

const kinds = ['control', 'explorer', 'worker', 'query', 'source', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output'] as const
const nullableText = { type: ['string', 'null'] }
const objectSchema = (properties: JsonRecord) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
})

export const agentToolDefinitions = [
  {
    type: 'function',
    name: 'list_card_kinds',
    description: 'Read every SAM LAB card role, activation condition, definition of done, compatibility and current evidence-driven recommendation before planning.',
    strict: true,
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'inspect_graph',
    description: 'Read the current graph, terminal catalog checkpoint summaries and every action already queued in this planning turn. Call before changing an existing graph.',
    strict: true,
    parameters: objectSchema({ node_ids: { type: 'array', items: { type: 'string' }, maxItems: 24 } }),
  },
  {
    type: 'function',
    name: 'read_catalog_checkpoint',
    description: 'Read one bounded host-owned Catalog Explorer checkpoint, its coverage, evidence-backed issues and recommended versioned source. A complete checkpoint is terminal and must not be restarted.',
    strict: true,
    parameters: objectSchema({ explorer_id: nullableText }),
  },
  {
    type: 'function',
    name: 'inspect_incident_context',
    description: 'Read the current host-owned incident fingerprint, lifecycle state, occurrences and affected branch. This is immutable evidence; incident writes remain owned by Electron.',
    strict: true,
    parameters: objectSchema({ incident_key: nullableText }),
  },
  {
    type: 'function',
    name: 'add_card',
    description: 'Queue one complete SAM LAB card. The host supplies safe defaults for nullable metadata. Human Review becomes a resumable branch checkpoint.',
    strict: true,
    parameters: objectSchema({
      node_id: { type: 'string' },
      kind: { type: 'string', enum: kinds },
      label: nullableText,
      description: nullableText,
      owner: nullableText,
      rule: nullableText,
      reason: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'update_card',
    description: 'Queue a bounded edit to one existing card. At least one nullable patch field must be non-null.',
    strict: true,
    parameters: objectSchema({
      node_id: { type: 'string' },
      kind: { type: ['string', 'null'], enum: [...kinds, null] },
      label: nullableText,
      description: nullableText,
      owner: nullableText,
      rule: nullableText,
      reason: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'connect_cards',
    description: 'Queue one connection. Use approved/quarantine only from Split and feedback only from Output to Live Monitor; otherwise use null.',
    strict: true,
    parameters: objectSchema({
      source: { type: 'string' },
      target: { type: 'string' },
      source_handle: { type: ['string', 'null'], enum: ['approved', 'quarantine', 'feedback', null] },
      reason: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'remove_connection',
    description: 'Queue removal of one existing connection by its exact edge id.',
    strict: true,
    parameters: objectSchema({ edge_id: { type: 'string' }, reason: { type: 'string' } }),
  },
  {
    type: 'function',
    name: 'validate_plan',
    description: 'Validate the queued virtual graph diff. Read and repair every rejection before finish_plan.',
    strict: true,
    parameters: objectSchema({}),
  },
  {
    type: 'function',
    name: 'finish_plan',
    description: 'Finish exactly once after validation. The host assembles and validates the final strict proposal; no graph mutation is executed here.',
    strict: true,
    parameters: objectSchema({
      title: { type: 'string' },
      summary: { type: 'string' },
      rationale: { type: 'string' },
      requires_human_review: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      writeback: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    }),
  },
] as const

interface CardPlanningContract {
  role: string
  activation: string
  completion: string
}

const cardRoles: Record<ProposalCardKind, CardPlanningContract> = {
  control: {
    role: 'Persist the autonomous objective and player resume/monitor policy.',
    activation: 'Use exactly one host-owned controller whenever Player is enabled; never connect it to lineage.',
    completion: 'Objective, on_review and on_idle policies are versioned.',
  },
  explorer: {
    role: 'Discover governed sources through one host-owned focused or catalog-wide sidecar.',
    activation: 'Use when no source is bound or an explicit refresh/new monitor event reopens discovery.',
    completion: 'A source is selected or a versioned terminal catalog checkpoint is complete.',
  },
  worker: {
    role: 'Process deterministic independent work in bounded branch-only batches.',
    activation: 'Use only for two or more independent catalog, incident, risk or patch work items.',
    completion: 'Every item completed, failed with evidence or checkpointed before atomic merge.',
  },
  query: {
    role: 'Verify a host-registered GraphQL aggregate-data read or governed write contract.',
    activation: 'Use when schema metadata cannot provide the required aggregate evidence, assertion or mutation receipt.',
    completion: 'The host-validated operation yields bounded evidence, an explicit failure or a reviewed receipt.',
  },
  source: {
    role: 'Resolve a governed dataset and start lineage.',
    activation: 'Use after a specific governed dataset identity has been selected.',
    completion: 'Identity, platform, environment and schema envelope are fresh and versioned.',
  },
  profile: {
    role: 'Keep compact versioned schema and aggregate value evidence without raw rows.',
    activation: 'Use when a source or query produced evidence that downstream cards need to reuse.',
    completion: 'A host-verified metadata-only snapshot records freshness, coverage and risk signals.',
  },
  analysis: {
    role: 'Classify trusted schema, aggregate value and lineage findings.',
    activation: 'Use when profile signals or gaps need classification before routing or remediation.',
    completion: 'Findings are classified as data anomaly, governance gap, collection failure or healthy.',
  },
  impact: {
    role: 'Trace a material finding through versioned lineage.',
    activation: 'Use when a change or anomaly has fresh upstream/downstream lineage.',
    completion: 'Affected datasets, features, pipelines, models and deployments are bounded and ranked.',
  },
  risk: {
    role: 'Classify data, privacy, operational, ML or collection risk from versioned evidence.',
    activation: 'Use after Analysis or Impact exposes a material finding, sensitive signal or governed change.',
    completion: 'Scope, domain/type, severity, confidence, evidence, affected assets and action are declared.',
  },
  patch: {
    role: 'Describe a reversible graph-only compatibility or protection overlay.',
    activation: 'Use only for a concrete mismatch supported by Analysis, Impact or Risk.',
    completion: 'The exact overlay is versioned and exposes a testable post-condition without source mutation.',
  },
  monitor: {
    role: 'Trigger a bounded iteration only when evidence changes.',
    activation: 'Use after a stable Output should be watched for a new fingerprint or higher severity.',
    completion: 'Fingerprint, cooldown and maximum iterations are armed; unchanged evidence stays idle.',
  },
  parallel: {
    role: 'Release independent branch-only agent work and merge reviewed diffs.',
    activation: 'Use when at least two independent sources, incidents or work groups can progress concurrently.',
    completion: 'Every branch returns a reviewed diff or bounded failure and conflicts remain visible.',
  },
  diagram: {
    role: 'Merge parallel incident branches into one reviewable workstream.',
    activation: 'Use when two or more incident branches must be understood together.',
    completion: 'Every input branch and conflict is represented in the merged diagram.',
  },
  split: {
    role: 'Route through explicit approved and quarantine outcomes.',
    activation: 'Use only for a real mutually exclusive policy decision.',
    completion: 'Both handles lead to explicit valid downstream behavior.',
  },
  decision: {
    role: 'Choose a supported correction or request human review.',
    activation: 'Use for a bounded correction-versus-escalation or uncertainty choice.',
    completion: 'Exactly one evidence-backed correction or one review checkpoint is selected.',
  },
  transform: {
    role: 'Declare a deterministic versioned derived-data or metadata transformation.',
    activation: 'Use for cast, normalization, mask, tokenization or aggregation that exceeds a graph-only alias patch.',
    completion: 'Inputs, outputs, invariants and rollback behavior are ready for atomic validation.',
  },
  review: {
    role: 'Pause one affected branch and persist a human decision.',
    activation: 'Use for high/critical risk, sensitive boundaries, external mutation or material uncertainty.',
    completion: 'Decision, rationale and diff identity are persisted for resume or repair.',
  },
  validation: {
    role: 'Run applicable atomic contracts and post-conditions.',
    activation: 'Use after any patch, transform, decision or review and before governed Output.',
    completion: 'All atoms pass or blockers identify the exact repairable contract.',
  },
  output: {
    role: 'Emit a validated governed artifact, decision or query receipt and its lineage.',
    activation: 'Use as the terminal result of a useful validated branch.',
    completion: 'Result references its validated inputs, version and review state and may feed a monitor.',
  },
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown, maximum: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const result = value.trim()
  return result ? result.slice(0, maximum) : null
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const result = text(value, maximum)
  if (!result) throw new Error(`${label} is required`)
  return result
}

function proposalWith(actions: ValidatedProposalAction[], metadata: Partial<ValidatedProposal> = {}) {
  return {
    title: metadata.title ?? 'Validate queued graph tools',
    summary: metadata.summary ?? 'Validate the current virtual graph diff.',
    rationale: metadata.rationale ?? 'Every queued action must satisfy the bounded SAM LAB proposal contract.',
    requires_human_review: metadata.requires_human_review ?? false,
    confidence: metadata.confidence ?? 1,
    writeback: metadata.writeback ?? 'Commit locally only after explicit approval.',
    evidence: metadata.evidence ?? [],
    actions,
  }
}

function graph(payload: unknown) {
  const root = record(payload)
  const value = record(root.graph)
  return {
    nodes: Array.isArray(value.nodes) ? value.nodes.map(record) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(record) : [],
  }
}

export class AgentToolSession {
  readonly trace: AgentToolTrace[] = []
  private readonly actions: ValidatedProposalAction[] = []
  private cardKindsListed = false
  private validatedActionCount?: number
  private finishedProposal?: ValidatedProposal

  constructor(private readonly payload: unknown) {}

  get finished() { return Boolean(this.finishedProposal) }
  get proposal() { return this.finishedProposal }
  private get reviewAssistantMode() { return record(this.payload).mode === 'review-assistant' }

  private result(tool: string, status: ToolStatus, summary: string, detail: JsonRecord = {}) {
    this.trace.push({ tool, status, summary })
    return { ok: status !== 'rejected', status, summary, ...detail }
  }

  private reject(tool: string, error: unknown) {
    const summary = error instanceof Error ? error.message : String(error)
    return this.result(tool, 'rejected', summary)
  }

  private validateCandidate(tool: string, action: ValidatedProposalAction) {
    if (this.reviewAssistantMode) throw new Error('Human Review assistant is read-only; graph actions are unavailable')
    const candidate = [...this.actions, action]
    validateProposal(proposalWith(candidate, { requires_human_review: this.includesReview(candidate) }), this.payload)
    this.actions.push(action)
    this.validatedActionCount = undefined
    return this.result(tool, 'accepted', `${action.type} queued`, { action })
  }

  private includesReview(actions = this.actions) {
    const existingReviews = new Set(graph(this.payload).nodes.filter((node) => node.kind === 'review').map((node) => node.id))
    return actions.some((action) => action.kind === 'review' || (action.type === 'update_card' && Boolean(action.node_id && existingReviews.has(action.node_id))))
  }

  private kindOf(nodeId: string): ProposalCardKind | undefined {
    const queued = [...this.actions].reverse().find((action) =>
      (action.type === 'add_card' || action.type === 'update_card') && action.node_id === nodeId && action.kind)
    if (queued?.kind) return queued.kind
    const node = graph(this.payload).nodes.find((candidate) => candidate.id === nodeId)
    return kinds.includes(node?.kind as ProposalCardKind) ? node?.kind as ProposalCardKind : undefined
  }

  private normalizedRule(kind: ProposalCardKind, value: unknown): string | null {
    const supplied = text(value, 2_000)
    if (kind === 'control') return supplied ?? 'objective=maintain governed graph | mode=autonomous | on_review=checkpoint_and_resume | on_idle=monitor'
    if (kind === 'review') return supplied ?? 'checkpoint=branch | on_approve=resume_next_iteration | on_reject=repair_loop'
    if (kind === 'parallel') return supplied ?? 'max_concurrency=3 | context=branch_only | merge=atomic'
    if (kind === 'explorer') return supplied ?? 'scope=all_datasets | batch_size=8 | audit_concurrency=4 | cache=prefer | checkpoint=versioned | resume=true'
    if (kind === 'worker') return supplied ?? 'role=generic | batch_size=4 | max_concurrency=4 | retry=checkpoint | context=branch_only | merge=atomic'
    if (kind === 'query') return supplied ?? 'connector=datahub | protocol=graphql | registry=connector_manifest | operation=profile.read | mode=read_only | variables=host_validated | timeout_ms=8000 | review=not_required | dry_run=not_applicable | rollback=not_applicable | response=bounded_aggregate_profile'
    if (kind === 'risk') return supplied ?? 'scope=downstream_assets | risk_domain=general | risk_type=none | severity=unknown | confidence=0 | evidence=unavailable | affected_assets=0 | action=read_versioned_lineage'
    if (kind === 'monitor') {
      let rule = supplied ?? ''
      const seen = new Set<string>()
      rule = rule.split(/\s*\|\s*/).filter(Boolean).filter((clause) => {
        const key = /^cooldown\s*=/i.test(clause)
          ? 'cooldown'
          : /^max_iterations\s*=/i.test(clause)
            ? 'max_iterations'
            : /^on_change\(metadata_fingerprint\)/i.test(clause)
              ? 'on_change'
              : clause
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).join(' | ')
      const clauses: string[] = []
      if (!/on_change\(metadata_fingerprint\)/i.test(rule)) clauses.push('on_change(metadata_fingerprint)')
      if (!/cooldown\s*=\s*\d+\s*(?:s|m|h)?\b/i.test(rule)) clauses.push('cooldown=60s')
      if (!/max_iterations=\d+/i.test(rule)) clauses.push('max_iterations=10')
      if (clauses.length) rule = [rule, ...clauses].filter(Boolean).join(' | ')
      return rule
    }
    return supplied
  }

  execute(tool: string, rawArguments: unknown): JsonRecord {
    if (this.finished) return this.result(tool, 'rejected', 'The plan is already finished')
    const args = record(rawArguments)
    try {
      if (tool === 'list_card_kinds') {
        this.cardKindsListed = true
        const activationPlan = new Map(
          (Array.isArray(record(this.payload).cardActivationPlan)
            ? record(this.payload).cardActivationPlan as unknown[]
            : []).map(record).flatMap((item) =>
            typeof item.kind === 'string' ? [[item.kind, item] as const] : []),
        )
        return this.result(tool, 'read', `${kinds.length} card kinds available`, {
          cards: kinds.map((kind) => ({
            kind,
            role: cardRoles[kind].role,
            activation: cardRoles[kind].activation,
            completion: cardRoles[kind].completion,
            current_state: activationPlan.get(kind)?.state ?? 'available',
            current_reason: activationPlan.get(kind)?.reason ?? 'No host activation recommendation was supplied.',
            accepts_from: kinds.filter((source) => proposalCardCompatibility[source].includes(kind)),
            connects_to: proposalCardCompatibility[kind],
            source_handles: kind === 'split' ? ['approved', 'quarantine'] : kind === 'output' ? ['feedback'] : [],
          })),
          connection_policy: {
            sidecars: ['control', 'explorer'],
            lineage_start: 'source',
            feedback: 'output.feedback -> monitor',
          },
          catalog_policy: {
            complete_is_terminal: true,
            repair: 'read_catalog_checkpoint -> restore recommended_source_urn -> inspect only that source',
            reopen_only_on: ['explicit_refresh', 'new_monitor_evidence'],
          },
        })
      }
      if (tool === 'inspect_graph') {
        const requested = Array.isArray(args.node_ids) ? new Set(args.node_ids.filter((id): id is string => typeof id === 'string')) : new Set<string>()
        const current = graph(this.payload)
        return this.result(tool, 'read', `${current.nodes.length} cards and ${current.edges.length} edges inspected`, {
          graph: {
            nodes: requested.size ? current.nodes.filter((node) => requested.has(String(node.id))) : current.nodes,
            edges: current.edges,
          },
          source_scope: record(record(this.payload).sourceScope),
          autonomy_policy: record(record(this.payload).autonomyPolicy),
          catalog_checkpoints: (Array.isArray(record(this.payload).catalogCheckpoints)
            ? record(this.payload).catalogCheckpoints as unknown[]
            : []).map(record).map((checkpoint) => ({
              explorerId: checkpoint.explorerId,
              state: checkpoint.state,
              inspected: checkpoint.inspected,
              total: checkpoint.total,
              terminal: checkpoint.terminal,
              recommendedSourceUrn: checkpoint.recommendedSourceUrn,
              restartPolicy: checkpoint.restartPolicy,
            })),
          queued_actions: this.actions,
        })
      }
      if (tool === 'read_catalog_checkpoint') {
        const root = record(this.payload)
        const checkpoints = Array.isArray(root.catalogCheckpoints) ? root.catalogCheckpoints.map(record) : []
        const explorerId = text(args.explorer_id, 120)
        const selected = explorerId
          ? checkpoints.filter((checkpoint) => checkpoint.explorerId === explorerId)
          : checkpoints
        return this.result(tool, 'read', `${selected.length} bounded catalog checkpoint(s) inspected`, {
          checkpoints: selected.slice(0, 4),
          policy: {
            complete_is_terminal: true,
            must_not_restart_complete_checkpoint: true,
            repair: 'Restore recommendedSourceUrn from version memory and inspect only that source before repairing the rejected diff.',
            reopen_only_on: ['explicit_refresh', 'new_monitor_evidence'],
            raw_rows_exposed: false,
          },
        })
      }
      if (tool === 'inspect_incident_context') {
        const root = record(this.payload)
        const incidents = Array.isArray(root.incidentContext) ? root.incidentContext.map(record) : []
        const incidentKey = text(args.incident_key, 180)
        const selected = incidentKey ? incidents.filter((incident) => incident.incidentKey === incidentKey) : incidents
        return this.result(tool, 'read', `${selected.length} host-owned incident record(s) inspected`, {
          incidents: selected.slice(0, 24),
          policy: 'Read-only evidence. Electron fingerprints, deduplicates and records transitions; agent tools may only queue a graph diff.',
        })
      }
      if (tool === 'add_card') {
        const kind = requiredText(args.kind, 'kind', 32) as ProposalCardKind
        if (!kinds.includes(kind)) throw new Error('Unknown SAM LAB card kind')
        const rule = this.normalizedRule(kind, args.rule)
        if (kind === 'patch' && !rule?.startsWith('graph_only:')) throw new Error('Compatibility Patch rule must begin with graph_only:')
        if (kind === 'risk') {
          const error = riskAssessmentRuleError(rule)
          if (error) throw new Error(error)
        }
        if (kind === 'worker') {
          const error = workerPolicyError(rule)
          if (error) throw new Error(error)
        }
        if (kind === 'query') {
          const error = queryCheckRuleError(rule)
          if (error) throw new Error(error)
        }
        if (kind === 'monitor' && (!rule?.includes('on_change(metadata_fingerprint)') || !rule.includes('cooldown=') || !rule.includes('max_iterations='))) {
          throw new Error('Live Monitor requires on_change(metadata_fingerprint), cooldown and max_iterations')
        }
        if (kind === 'parallel' && (!rule?.includes('context=branch_only') || !rule.includes('merge=atomic'))) {
          throw new Error('Parallel Agents requires context=branch_only and merge=atomic')
        }
        if (kind === 'control' && (!rule?.includes('objective=') || !rule.includes('on_review=') || !rule.includes('on_idle='))) {
          throw new Error('SAM LAB Control requires objective, on_review and on_idle policies')
        }
        return this.validateCandidate(tool, {
          type: 'add_card',
          node_id: requiredText(args.node_id, 'node_id', 120),
          kind,
          label: text(args.label, 120),
          description: text(args.description, 500),
          owner: text(args.owner, 120),
          rule,
          source: null,
          target: null,
          source_handle: null,
          reason: requiredText(args.reason, 'reason', 500),
        })
      }
      if (tool === 'update_card') {
        const kind = text(args.kind, 32) as ProposalCardKind | null
        if (kind && !kinds.includes(kind)) throw new Error('Unknown SAM LAB card kind')
        const nodeId = requiredText(args.node_id, 'node_id', 120)
        const label = text(args.label, 120)
        const description = text(args.description, 500)
        const owner = text(args.owner, 120)
        const effectiveKind = kind ?? this.kindOf(nodeId)
        const suppliedRule = text(args.rule, 2_000)
        const rule = effectiveKind === 'monitor'
          ? suppliedRule ? this.normalizedRule('monitor', suppliedRule) : null
          : kind ? this.normalizedRule(kind, args.rule) : suppliedRule
        if (effectiveKind === 'risk' && suppliedRule) {
          const error = riskAssessmentRuleError(rule)
          if (error) throw new Error(error)
        }
        if (effectiveKind === 'worker' && suppliedRule) {
          const error = workerPolicyError(rule)
          if (error) throw new Error(error)
        }
        if (effectiveKind === 'query' && suppliedRule) {
          const error = queryCheckRuleError(rule)
          if (error) throw new Error(error)
        }
        if (!kind && !label && !description && !owner && !rule) throw new Error('update_card requires at least one changed field')
        return this.validateCandidate(tool, {
          type: 'update_card',
          node_id: nodeId,
          kind,
          label,
          description,
          owner,
          rule,
          source: null,
          target: null,
          source_handle: null,
          reason: requiredText(args.reason, 'reason', 500),
        })
      }
      if (tool === 'connect_cards') {
        const source = requiredText(args.source, 'source', 120)
        const target = requiredText(args.target, 'target', 120)
        const sourceHandle = text(args.source_handle, 24)
        if (sourceHandle && !['approved', 'quarantine', 'feedback'].includes(sourceHandle)) throw new Error('Unknown connection handle')
        if ((sourceHandle === 'approved' || sourceHandle === 'quarantine') && this.kindOf(source) !== 'split') {
          throw new Error(`${sourceHandle} is valid only on an edge leaving a Split card`)
        }
        if (sourceHandle === 'feedback' && (this.kindOf(source) !== 'output' || this.kindOf(target) !== 'monitor')) {
          throw new Error('feedback is valid only from Output to Live Monitor')
        }
        return this.validateCandidate(tool, {
          type: 'add_edge',
          node_id: null,
          kind: null,
          label: null,
          description: null,
          owner: null,
          rule: null,
          source,
          target,
          source_handle: sourceHandle,
          reason: requiredText(args.reason, 'reason', 500),
        })
      }
      if (tool === 'remove_connection') {
        return this.validateCandidate(tool, {
          type: 'remove_edge',
          node_id: requiredText(args.edge_id, 'edge_id', 120),
          kind: null,
          label: null,
          description: null,
          owner: null,
          rule: null,
          source: null,
          target: null,
          source_handle: null,
          reason: requiredText(args.reason, 'reason', 500),
        })
      }
      if (tool === 'validate_plan') {
        const proposal = validateProposal(proposalWith(this.actions, { requires_human_review: this.includesReview() }), this.payload)
        this.validatedActionCount = proposal.actions.length
        const completeCheckpoints = (Array.isArray(record(this.payload).catalogCheckpoints)
          ? record(this.payload).catalogCheckpoints as unknown[]
          : []).map(record).filter((checkpoint) => checkpoint.terminal === true)
        return this.result(tool, 'read', `${proposal.actions.length} queued action(s) satisfy the proposal contract`, {
          action_count: proposal.actions.length,
          catalog_checkpoint_policy: completeCheckpoints.length
            ? 'Complete checkpoint is terminal; this plan must repair from its recommended source without restarting catalog discovery.'
            : 'Resume only remaining bounded catalog work.',
        })
      }
      if (tool === 'finish_plan') {
        if (this.reviewAssistantMode && this.actions.length) throw new Error('Human Review assistant must finish with zero graph actions')
        if (!this.reviewAssistantMode && !this.cardKindsListed) throw new Error('Call list_card_kinds before finishing the plan')
        if (!this.reviewAssistantMode && this.validatedActionCount !== this.actions.length) throw new Error('Call validate_plan after the last queued change before finishing the plan')
        const proposal = validateProposal(proposalWith(this.actions, {
          title: requiredText(args.title, 'title', 160),
          summary: requiredText(args.summary, 'summary', 800),
          rationale: requiredText(args.rationale, 'rationale', 1_600),
          requires_human_review: args.requires_human_review === true,
          confidence: typeof args.confidence === 'number' ? args.confidence : Number.NaN,
          writeback: requiredText(args.writeback, 'writeback', 800),
          evidence: Array.isArray(args.evidence) ? args.evidence.map((item) => requiredText(item, 'evidence', 500)) : [],
        }), this.payload)
        this.finishedProposal = proposal
        return this.result(tool, 'accepted', `Plan finished with ${proposal.actions.length} validated action(s)`)
      }
      return this.result(tool, 'rejected', `Unknown agent tool: ${tool}`)
    } catch (error) {
      return this.reject(tool, error)
    }
  }
}
