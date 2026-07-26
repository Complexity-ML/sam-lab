import type { Edge } from '@xyflow/react'
import { cardRoleContracts } from './agent-runner'
import type { CardKind, PipelineNode } from './pipeline'

export type CardActivationState = 'host-owned' | 'present' | 'recommended' | 'available'

export interface CardActivationRecommendation {
  kind: CardKind
  state: CardActivationState
  reason: string
}
interface FindingLike {
  detail?: string
  severity?: string
  title?: string
}

const cardKinds = Object.keys(cardRoleContracts) as CardKind[]

function findingText(findings: FindingLike[]) {
  return findings.map((finding) => `${finding.title ?? ''} ${finding.detail ?? ''}`).join(' ').toLowerCase()
}

function ruleText(nodes: PipelineNode[], kind: CardKind) {
  return nodes.filter((node) => node.data.kind === kind).map((node) => node.data.rule ?? '').join(' ').toLowerCase()
}

export function buildCardActivationPlan(
  nodes: PipelineNode[],
  edges: Edge[],
  findings: FindingLike[] = [],
  incidentCount = 0,
): CardActivationRecommendation[] {
  const presentKinds = new Set(nodes.map((node) => node.data.kind))
  const sources = nodes.filter((node) => node.data.kind === 'source')
  const profiles = nodes.filter((node) => node.data.kind === 'profile' && node.data.profile)
  const explorers = nodes.filter((node) => node.data.kind === 'explorer' && node.data.exploration)
  const explorerRemaining = explorers.reduce((total, node) => total + (node.data.exploration?.remaining
    ?? Math.max(0, (node.data.exploration?.total ?? 0) - (node.data.exploration?.inspected ?? 0))), 0)
  const terminalExplorer = explorers.some((node) => node.data.exploration?.state === 'complete')
  const aggregateCoverageGap = profiles.some((node) => node.data.profile?.aggregateAudit.status !== 'complete')
  const aggregateRisk = profiles.some((node) => (node.data.profile?.aggregateAudit.riskSignals.length ?? 0) > 0)
  const anomalyEvidence = profiles.some((node) => (node.data.profile?.anomalies.length ?? 0) > 0)
  const sensitiveEvidence = profiles.some((node) => (node.data.profile?.sensitiveFieldCount ?? 0) > 0)
  const failingQuality = nodes.some((node) => node.data.datahubQuality === 'failing' || node.data.profile?.quality === 'failing')
  const lineageEvidence = nodes.some((node) =>
    (node.data.profile?.upstreamCount ?? 0) > 0
    || (node.data.profile?.downstreamCount ?? 0) > 0
    || (node.data.datahubUpstream?.length ?? 0) > 0
    || (node.data.datahubDownstream?.length ?? 0) > 0)
  const materialEvidence = aggregateRisk || anomalyEvidence || failingQuality || sensitiveEvidence
  const changePresent = presentKinds.has('patch') || presentKinds.has('transform')
  const validationBlocked = findings.some((finding) => finding.severity === 'blocking' || finding.severity === 'error')
  const findingsText = findingText(findings)
  const transformNeeded = /\b(mask|token|redact|cast|normaliz|encrypt|type mismatch|schema mismatch)\b/.test(findingsText)
  const patchNeeded = transformNeeded || /\b(compatib|contract|protection|sensitive|pii)\b/.test(findingsText)
  const highRisk = /\b(?:severity|risk)[=: ]+(?:high|critical)\b/.test(ruleText(nodes, 'risk'))
    || findings.some((finding) => /\b(?:high|critical)\b/i.test(`${finding.title ?? ''} ${finding.detail ?? ''}`))
  const branchCount = Math.max(
    sources.length,
    nodes.filter((node) => node.data.kind === 'risk').length,
    incidentCount,
  )
  const hasOutputFeedback = edges.some((edge) =>
    edge.sourceHandle === 'feedback'
    && nodes.find((node) => node.id === edge.source)?.data.kind === 'output'
    && nodes.find((node) => node.id === edge.target)?.data.kind === 'monitor')

  const recommend = (kind: CardKind): string | undefined => {
    switch (kind) {
      case 'control':
        return nodes.length === 0 || !presentKinds.has('control')
          ? 'The autonomous player needs one host-owned objective and resume policy.'
          : undefined
      case 'explorer':
        return !presentKinds.has('explorer') && sources.length === 0
          ? 'No governed source is bound; discover or select one without entering dataset lineage.'
          : undefined
      case 'worker':
        return !presentKinds.has('worker') && (explorerRemaining > 1 || branchCount > 1)
          ? 'Multiple independent catalog or incident work items can be checkpointed and merged atomically.'
          : undefined
      case 'query':
        return sources.length > 0 && (profiles.length === 0 || aggregateCoverageGap)
          ? 'The selected source lacks a complete host-verified aggregate data audit.'
          : undefined
      case 'source':
        return sources.length === 0 && terminalExplorer
          ? 'Catalog discovery is terminal; bind its recommended governed dataset as the lineage start.'
          : undefined
      case 'profile':
        return sources.length > profiles.length
          ? 'At least one bound source has no compact reusable evidence snapshot.'
          : undefined
      case 'analysis':
        return profiles.length > 0 && !presentKinds.has('analysis') && (materialEvidence || aggregateCoverageGap)
          ? 'Profile evidence contains signals or gaps that still need classification.'
          : undefined
      case 'impact':
        return !presentKinds.has('impact') && lineageEvidence && (materialEvidence || changePresent)
          ? 'A material finding or proposed change has versioned lineage that can bound downstream impact.'
          : undefined
      case 'risk':
        return !presentKinds.has('risk') && (materialEvidence || presentKinds.has('impact'))
          ? 'Material data, privacy, operational or ML evidence requires an explicit risk decision.'
          : undefined
      case 'patch':
        return !presentKinds.has('patch') && patchNeeded && (presentKinds.has('analysis') || presentKinds.has('impact') || presentKinds.has('risk'))
          ? 'A concrete compatibility or protection blocker has a reversible graph-only mitigation.'
          : undefined
      case 'monitor':
        return presentKinds.has('output') && !presentKinds.has('monitor') && !hasOutputFeedback
          ? 'A stable terminal result exists but no evidence-change loop is armed.'
          : undefined
      case 'parallel':
        return !presentKinds.has('parallel') && branchCount > 1
          ? 'Two or more independent source or incident branches can progress with branch-only context.'
          : undefined
      case 'diagram':
        return !presentKinds.has('diagram') && (presentKinds.has('parallel') || incidentCount > 1)
          ? 'Multiple incident workstreams need one conflict-preserving overview.'
          : undefined
      case 'split':
        return !presentKinds.has('split') && presentKinds.has('risk') && (highRisk || validationBlocked)
          ? 'Risk evidence needs explicit approved and quarantine outcomes.'
          : undefined
      case 'decision':
        return !presentKinds.has('decision')
          && (presentKinds.has('analysis') || presentKinds.has('impact') || presentKinds.has('risk'))
          && !presentKinds.has('patch')
          && !presentKinds.has('review')
          ? 'Evidence supports a bounded correction-versus-escalation choice.'
          : undefined
      case 'transform':
        return !presentKinds.has('transform') && transformNeeded
          ? 'The blocker requires a deterministic derived contract rather than a graph-only alias.'
          : undefined
      case 'review':
        return !presentKinds.has('review') && (highRisk || sensitiveEvidence || validationBlocked)
          ? 'High-risk, sensitive or blocked work requires a durable human decision on the affected branch.'
          : undefined
      case 'validation':
        return !presentKinds.has('validation') && sources.length > 0
          && (changePresent || presentKinds.has('risk') || presentKinds.has('decision') || presentKinds.has('review'))
          ? 'A material branch decision exists but no atomic post-condition gate protects its output.'
          : undefined
      case 'output':
        return !presentKinds.has('output') && sources.length > 0 && profiles.length > 0
          ? 'The governed branch has evidence but no terminal versioned result.'
          : undefined
    }
  }

  return cardKinds.map((kind) => {
    const recommendation = recommend(kind)
    const hostOwned = kind === 'control' || kind === 'explorer' || kind === 'worker'
    return {
      kind,
      state: presentKinds.has(kind) ? 'present'
        : recommendation ? hostOwned ? 'host-owned' : 'recommended'
          : 'available',
      reason: presentKinds.has(kind)
        ? `A ${cardRoleContracts[kind].role} is already present; update or reuse it instead of duplicating it.`
        : recommendation ?? `No current evidence satisfies this card's activation condition.`,
    }
  })
}
