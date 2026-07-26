import type { Edge } from '@xyflow/react'
import type { AgentRunTraceStep, CardKind, PipelineNode } from './pipeline'

export interface CardRoleContract {
  role: string
  mission: string
  activation: string
  completion: string
  input: string
  output: string
  allowedTools: string[]
}

export const cardRoleContracts: Record<CardKind, CardRoleContract> = {
  control: {
    role: 'SAM LAB autonomous controller',
    mission: 'Persist the operator objective, start the governed route, resume after approved reviews, and enter monitoring when the graph is stable.',
    activation: 'Host-owned whenever the autonomous player exists; keep exactly one controller outside dataset lineage.',
    completion: 'The objective, review-resume policy and idle-monitor policy are versioned and inspectable.',
    input: 'OperatorPolicy + VersionMemory + PlayerState',
    output: 'BoundedAgentObjective',
    allowedTools: [],
  },
  explorer: {
    role: 'Software inventory exploration coordinator',
    mission: 'Discover software assets across connected inventories, contracts and usage sources in bounded batches, deduplicate identities and preserve a resumable coverage checkpoint.',
    activation: 'Use when no inventory is bound, when the operator requests portfolio coverage, or when a monitor detects new software evidence.',
    completion: 'Each discovered product has a stable identity and source provenance, or a versioned checkpoint records the exact coverage gap.',
    input: 'ConnectorInventory + PreviousInventoryCheckpoint',
    output: 'InventoryCoverage + AssetFingerprints + EvidenceGaps',
    allowedTools: ['catalog.search', 'entity.read', 'schema.read'],
  },
  worker: {
    role: 'Bounded execution worker',
    mission: 'Process one deterministic batch with branch-only context, preserve a replayable checkpoint, and return an atomically mergeable result for exploration, risk, incident or patch workflows.',
    activation: 'Use when at least two independent deterministic work items can execute without sharing mutable branch state.',
    completion: 'Every work item is completed, failed with evidence, or checkpointed for bounded retry before one atomic merge.',
    input: 'TypedWorkItems + PreviousWorkerCheckpoint',
    output: 'CompletedItems + FailedItems + WorkerCheckpoint',
    allowedTools: [],
  },
  query: {
    role: 'License entitlement matcher',
    mission: 'Compare normalized installations and assignments with purchased rights using a registered, inspectable matching rule.',
    activation: 'Use when inventory and contract evidence must be reconciled before utilization, cost or compliance analysis.',
    completion: 'Each in-scope product is matched, unmatched or explicitly unresolved with provenance and confidence.',
    input: 'NormalizedAssets + ContractEntitlements + MatchingPolicy',
    output: 'EntitlementMatches + UnmatchedAssets + EvidenceGaps',
    allowedTools: ['catalog.search', 'profile.read', 'entity.read', 'schema.read'],
  },
  source: {
    role: 'Software evidence loader',
    mission: 'Bind an inventory, contract, assignment, usage or renewal source and preserve its provenance.',
    activation: 'Use once a specific SAM evidence source is selected from a connector, file or operator scope.',
    completion: 'The source identity, evidence type, freshness and bounded field contract are versioned.',
    input: 'Inventory | Contract | Assignment | Usage | Renewal evidence',
    output: 'SoftwareEvidenceSource',
    allowedTools: ['entity.read', 'schema.read'],
  },
  profile: {
    role: 'Software asset normalization memory',
    mission: 'Normalize vendor, product, owner, edition, device and account identities into a compact replayable portfolio snapshot.',
    activation: 'Use after one or more Asset Sources produce records that later stages should not repeatedly reconcile.',
    completion: 'A versioned snapshot records normalized identities, coverage, freshness and unresolved duplicates without secrets.',
    input: 'SoftwareEvidenceSource[] + NormalizationPolicy',
    output: 'VersionedAssetPortfolio',
    allowedTools: ['profile.read', 'entity.read', 'schema.read', 'lineage.read'],
  },
  analysis: {
    role: 'Software utilization analyst',
    mission: 'Compare purchased, assigned and active seats; classify unused capacity, duplicate tools, owner gaps and unreliable collection evidence.',
    activation: 'Use when a normalized portfolio contains enough bounded assignment or usage evidence for a defensible finding.',
    completion: 'Each finding names the software asset, observed evidence, severity and evidence limitation.',
    input: 'VersionedAssetPortfolio + UsageSnapshot',
    output: 'UtilizationFindings + CoverageGaps',
    allowedTools: ['profile.read', 'entity.read', 'schema.read', 'lineage.read'],
  },
  impact: {
    role: 'Cost and renewal impact analyst',
    mission: 'Calculate annual spend, recoverable waste and renewal exposure from matched entitlement and usage evidence.',
    activation: 'Use after matching or utilization analysis produces a bounded software population with prices or renewal dates.',
    completion: 'Every amount is reproducible from source evidence and uncertain pricing remains explicitly unknown.',
    input: 'EntitlementMatches + UtilizationFindings + RenewalEvidence',
    output: 'CostImpactReport + RenewalPriorities',
    allowedTools: ['entity.read', 'schema.read'],
  },
  risk: {
    role: 'Software compliance risk assessor',
    mission: 'Classify entitlement, compliance, security, renewal and financial risk while keeping missing connector evidence separate from confirmed exposure.',
    activation: 'Use after matching, utilization or cost analysis exposes a material finding or evidence gap.',
    completion: 'Scope, domain, severity, confidence, evidence freshness, affected assets and recommended action are declared.',
    input: 'VersionedAssetPortfolio + AnalysisFindings + CostImpactReport',
    output: 'SamRiskContext + Severity + Confidence + AffectedAssets + RecommendedAction',
    allowedTools: ['profile.read', 'entity.read', 'schema.read'],
  },
  patch: {
    role: 'Software optimization planner',
    mission: 'Create a deterministic, reversible reclaim, downgrade, consolidation or renewal proposal without silently changing a vendor system.',
    activation: 'Use only when Analysis, Impact or Risk supports a concrete and reviewable SAM action.',
    completion: 'The proposal names affected assets, expected savings, rollback behavior and required approval.',
    input: 'SamRiskContext + CostImpactReport',
    output: 'VersionedOptimizationPlan',
    allowedTools: [],
  },
  monitor: {
    role: 'Evidence change monitor',
    mission: 'Start a new bounded atomic iteration only when a versioned connector evidence fingerprint changes or severity increases.',
    activation: 'Use after a stable validated branch has an Output whose evidence should be watched for later change.',
    completion: 'The monitor is armed with a fingerprint, cooldown and maximum iterations; unchanged evidence remains idle.',
    input: 'CurrentEvidence + PreviousEvidenceFingerprint',
    output: 'NoChange | BoundedIterationTrigger | HumanAlert',
    allowedTools: ['entity.read', 'schema.read', 'lineage.read'],
  },
  parallel: {
    role: 'Parallel branch orchestrator',
    mission: 'Delegate independent graph branches with branch-only context, observe usage, and merge proposal diffs only after atomic validation.',
    activation: 'Use when two or more sources, incidents or independent work groups can progress without waiting on the same branch state.',
    completion: 'Every branch returns a reviewed diff or bounded failure and the merge preserves conflicts instead of silently choosing one result.',
    input: 'CompletedPredecessor + ImmutableSharedEvidence',
    output: 'ReviewedBranchDiff[]',
    allowedTools: [],
  },
  diagram: {
    role: 'Incident branch merger',
    mission: 'Relate parallel incident subgraphs, surface conflicts, and expose one atomically reviewable merged diagram.',
    activation: 'Use when at least two incident or parallel-agent branches must be understood together on the same canvas.',
    completion: 'The diagram names every input branch, preserves conflicts and exposes one reviewable merged workstream.',
    input: 'ReviewedBranchDiff[] + IncidentTimeline',
    output: 'IncidentWorkstreamDiagram',
    allowedTools: [],
  },
  split: {
    role: 'Policy router',
    mission: 'Choose the governed branch from an explicit, inspectable rule.',
    activation: 'Use when one evidence result must follow mutually exclusive approved and quarantine outcomes.',
    completion: 'Both approved and quarantine handles are connected to explicit, valid downstream behavior.',
    input: 'AnalysisFindings',
    output: 'ApprovedBranch | QuarantineBranch',
    allowedTools: [],
  },
  decision: {
    role: 'Decision agent',
    mission: 'Choose the smallest supported correction or request a human when confidence is insufficient.',
    activation: 'Use when evidence supports multiple bounded actions, a correction-vs-escalation choice, or an uncertainty threshold.',
    completion: 'Exactly one supported correction path or one Human Review checkpoint is selected with its evidence.',
    input: 'ApprovedBranch + AnalysisFindings',
    output: 'ReviewedChangeProposal',
    allowedTools: ['entity.read', 'schema.read', 'lineage.read'],
  },
  transform: {
    role: 'Versioned deterministic transformer',
    mission: 'Declare a deterministic derived-data or metadata transformation while preserving source identity and never mutating the governed source implicitly.',
    activation: 'Use when the correction genuinely requires a new derived contract such as cast, normalization, mask, tokenization or aggregation beyond a graph-only alias patch.',
    completion: 'Inputs, outputs, invariants and rollback behavior are versioned and ready for atomic post-condition validation.',
    input: 'VersionedInputContract + ApprovedTransformRule',
    output: 'VersionedDerivedContract',
    allowedTools: [],
  },
  review: {
    role: 'Human approval gate',
    mission: 'Pause autonomous execution until a named human approves the complete diff.',
    activation: 'Use for high/critical risk, sensitive-data boundary changes, external mutations or material uncertainty; block only the affected branch.',
    completion: 'The human decision, rationale and approved diff identity are persisted so approval resumes and rejection repairs the same branch.',
    input: 'ReviewedChangeProposal',
    output: 'ApprovedChange | RejectedChange',
    allowedTools: [],
  },
  validation: {
    role: 'Atomic validator',
    mission: 'Run every independent contract and stop on any blocking finding.',
    activation: 'Use after any patch, transform, decision or review and before an Output can claim a governed result.',
    completion: 'Every applicable atomic invariant passes, or blockers identify the exact card and repairable contract.',
    input: 'VersionedBranchState + GovernancePolicy + ExpectedPostConditions',
    output: 'ValidationResult',
    allowedTools: [],
  },
  output: {
    role: 'Governed publisher',
    mission: 'Emit only a fully validated governed result and its version lineage without implying that source data was changed.',
    activation: 'Use as the terminal card for a validated report, decision, query receipt, derived contract or other governed branch result.',
    completion: 'The emitted result references its validated inputs, version and review state and is eligible for monitoring feedback.',
    input: 'ValidatedGovernedResult',
    output: 'VersionedArtifact | DecisionRecord | QueryReceipt',
    allowedTools: [],
  },
}

function edgePriority(edge: Edge) {
  if (edge.sourceHandle === 'feedback') return 3
  if (edge.sourceHandle === 'approved') return 0
  if (edge.sourceHandle === 'quarantine') return 2
  return 1
}

export function planPrimaryAgentRoute(nodes: PipelineNode[], edges: Edge[]): PipelineNode[] {
  const executableNodes = nodes.filter((node) => node.data.kind !== 'profile' && node.data.kind !== 'control')
  const iterationEdges = edges.filter((edge) => edge.sourceHandle !== 'feedback')
  const byId = new Map(executableNodes.map((node) => [node.id, node]))
  const incoming = new Set(iterationEdges.map((edge) => edge.target))
  const sources = executableNodes
    .filter((node) => node.data.kind === 'source' || !incoming.has(node.id))
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
  const route: PipelineNode[] = []
  const visited = new Set<string>()
  let current: PipelineNode | undefined = sources[0]

  while (current && !visited.has(current.id)) {
    route.push(current)
    visited.add(current.id)
    const currentId: string = current.id
    const nextEdge: Edge | undefined = iterationEdges
      .filter((edge) => edge.source === currentId && byId.has(edge.target))
      .sort((left, right) => edgePriority(left) - edgePriority(right)
        || (byId.get(left.target)?.position.x ?? 0) - (byId.get(right.target)?.position.x ?? 0)
        || (byId.get(left.target)?.position.y ?? 0) - (byId.get(right.target)?.position.y ?? 0))[0]
    current = nextEdge ? byId.get(nextEdge.target) : undefined
  }

  return route
}

export function traceStep(node: PipelineNode, state: AgentRunTraceStep['state'], summary: string): AgentRunTraceStep {
  return { nodeId: node.id, label: node.data.label, role: cardRoleContracts[node.data.kind].role, state, summary }
}
