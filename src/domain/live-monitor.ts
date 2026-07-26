import type { Edge } from '@xyflow/react'
import type { DataHubMcpAudit } from '../electron-api'
import type { IncidentSeverity, IncidentTransition } from './incidents'
import type { PipelineNode } from './pipeline'

export interface LiveMonitorPolicy {
  cooldownMs: number
  maxIterations: number
}

export interface MonitorObservation {
  fingerprint: string
  severity: IncidentSeverity
  failedReads: number
  totalReads: number
  category: 'none' | 'connector' | 'data' | 'governance' | 'impact'
  riskScore: number
  reasons: string[]
}

export interface MonitorRuntimeState {
  fingerprint?: string
  severity: IncidentSeverity
  open: boolean
  iterations: number
}

export interface MonitorDecision {
  next: MonitorRuntimeState
  transition?: Extract<IncidentTransition, 'opened' | 'worsened' | 'recovered'>
  triggerAgent: boolean
  escalateToHumanReview: boolean
}

export interface PostCorrectionVerification {
  incidentKey: string
  versionId: string
  baselineFingerprint: string
  registeredAt: string
}

export interface PostCorrectionDecision {
  passed: boolean
  next: MonitorRuntimeState
  triggerAgent: boolean
  escalateToHumanReview: boolean
}

export interface BoundLiveMonitor {
  monitorId: string
  monitorLabel: string
  sourceId: string
  sourceLabel: string
  urn: string
  policy: LiveMonitorPolicy
}

export function liveMonitorBindingKey(monitor: Pick<BoundLiveMonitor, 'monitorId' | 'urn'>) {
  return `${monitor.monitorId}::${monitor.urn}`
}

export const monitorSeverityRank: Record<IncidentSeverity, number> = { info: 0, warning: 1, critical: 2 }

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function parseLiveMonitorPolicy(rule?: string): LiveMonitorPolicy {
  const cooldown = rule?.match(/cooldown\s*=\s*(\d+)\s*([smh])?/i)
  const cooldownAmount = Number(cooldown?.[1] ?? 60)
  const cooldownMultiplier = cooldown?.[2]?.toLowerCase() === 'h' ? 3_600 : cooldown?.[2]?.toLowerCase() === 'm' ? 60 : 1
  const cooldownSeconds = cooldownAmount * cooldownMultiplier
  const maxIterations = Number(rule?.match(/max_iterations\s*=\s*(\d+)/i)?.[1] ?? 10)
  return {
    cooldownMs: Math.min(3_600, Math.max(10, cooldownSeconds)) * 1_000,
    maxIterations: Math.min(100, Math.max(1, maxIterations)),
  }
}

export function observeDataHubAudit(audit: DataHubMcpAudit): MonitorObservation {
  const asset = audit.asset
  const assetCanonical = asset
    ? [
        asset.urn,
        asset.qualityStatus,
        [...asset.owners].sort().join(','),
        [...asset.tags].sort().join(','),
        asset.fields.map((field) => `${field.name}:${field.type}:${[...(field.tags ?? [])].sort().join(',')}`).sort().join(';'),
        asset.upstream.map((item) => `${item.urn}:${item.sensitive}`).sort().join(','),
        asset.downstream.map((item) => `${item.urn}:${item.sensitive}`).sort().join(','),
      ].join('|')
    : ''
  const canonical = `${audit.reads
    .map((read) => `${read.name}:${read.status}:${read.stale ? 'stale' : 'fresh'}:${read.summary}`)
    .sort()
    .join('|')}|${assetCanonical}`
  const failedReads = audit.reads.filter((read) => read.status !== 'ok' || read.stale).length
  const reasons: string[] = []
  let riskScore = failedReads === audit.reads.length ? 6 : failedReads > 0 ? 3 : 0
  let category: MonitorObservation['category'] = failedReads > 0 ? 'connector' : 'none'
  if (failedReads > 0) reasons.push(`${failedReads}/${audit.reads.length} connector evidence reads are unavailable or stale.`)
  if (asset && failedReads < audit.reads.length) {
    const sensitiveFields = asset.fields.filter((field) => field.tags?.some((tag) => /pii|sensitive|personal|gdpr|secret|credential/i.test(tag))).length
    const sensitiveTags = asset.tags.filter((tag) => /pii|sensitive|personal|gdpr|secret|credential/i.test(tag)).length
    const sensitiveDownstream = asset.downstream.filter((item) => item.sensitive).length
    const lineageRadius = asset.upstream.length + asset.downstream.length
    if (asset.qualityStatus === 'failing') {
      riskScore += 5
      category = 'data'
      reasons.push(`${asset.name}: quality checks are failing.`)
    }
    if (!asset.owners.length) {
      riskScore += 2
      if (category === 'none') category = 'governance'
      reasons.push(`${asset.name}: no accountable owner is recorded.`)
    }
    if (sensitiveFields || sensitiveTags) {
      riskScore += 3
      if (category === 'none' || category === 'governance') category = 'data'
      reasons.push(`${asset.name}: ${sensitiveFields || sensitiveTags} sensitive field/tag signal(s).`)
    }
    if (sensitiveDownstream) {
      riskScore += 4
      category = 'impact'
      reasons.push(`${asset.name}: ${sensitiveDownstream} sensitive downstream asset(s).`)
    }
    if (lineageRadius >= 20) {
      riskScore += 4
      category = 'impact'
      reasons.push(`${asset.name}: lineage blast radius covers ${lineageRadius} assets.`)
    } else if (lineageRadius >= 5) {
      riskScore += 2
      if (category === 'none') category = 'impact'
      reasons.push(`${asset.name}: lineage reaches ${lineageRadius} assets.`)
    }
  }
  const severity: IncidentSeverity = riskScore >= 6 ? 'critical' : riskScore >= 3 ? 'warning' : 'info'
  return {
    fingerprint: stableHash(canonical),
    severity,
    failedReads,
    totalReads: audit.reads.length,
    category,
    riskScore,
    reasons,
  }
}

export function evaluateMonitorObservation(previous: MonitorRuntimeState | undefined, observation: MonitorObservation, policy: LiveMonitorPolicy): MonitorDecision {
  const baseline: MonitorRuntimeState = previous ?? { severity: 'info', open: false, iterations: 0 }
  if (baseline.fingerprint === observation.fingerprint && baseline.severity === observation.severity) {
    return { next: baseline, triggerAgent: false, escalateToHumanReview: false }
  }

  if (observation.severity === 'info') {
    return {
      next: { fingerprint: observation.fingerprint, severity: 'info', open: false, iterations: 0 },
      transition: baseline.open ? 'recovered' : undefined,
      triggerAgent: false,
      escalateToHumanReview: false,
    }
  }

  const transition = baseline.open ? 'worsened' : 'opened'
  const iterations = baseline.iterations + 1
  const changedOrWorse = !baseline.open || baseline.fingerprint !== observation.fingerprint || monitorSeverityRank[observation.severity] > monitorSeverityRank[baseline.severity]
  return {
    next: { fingerprint: observation.fingerprint, severity: observation.severity, open: true, iterations },
    transition,
    triggerAgent: iterations <= policy.maxIterations && changedOrWorse,
    escalateToHumanReview: iterations === policy.maxIterations + 1 && changedOrWorse,
  }
}

export function verifyPostCorrectionObservation(
  previous: MonitorRuntimeState | undefined,
  observation: MonitorObservation,
  policy: LiveMonitorPolicy,
): PostCorrectionDecision {
  const baseline = previous ?? { severity: observation.severity, open: observation.severity !== 'info', iterations: 0 }
  if (observation.severity === 'info') {
    return {
      passed: true,
      next: { fingerprint: observation.fingerprint, severity: 'info', open: false, iterations: 0 },
      triggerAgent: false,
      escalateToHumanReview: false,
    }
  }
  const iterations = baseline.iterations + 1
  return {
    passed: false,
    next: { fingerprint: observation.fingerprint, severity: observation.severity, open: true, iterations },
    triggerAgent: iterations <= policy.maxIterations,
    escalateToHumanReview: iterations === policy.maxIterations + 1,
  }
}

export function findBoundLiveMonitors(nodes: PipelineNode[], edges: Edge[]): BoundLiveMonitor[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.sourceHandle === 'feedback') continue
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  }

  return nodes.filter((node) => node.data.kind === 'monitor').flatMap((monitor) => {
    const queue = [monitor.id]
    const visited = new Set<string>()
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const node = byId.get(current)
      if (node?.data.kind === 'source' && (!node.data.connectorId || node.data.connectorId === 'datahub') && (node.data.assetRef || node.data.datahubUrn)) {
        return [{
          monitorId: monitor.id,
          monitorLabel: monitor.data.label,
          sourceId: node.id,
          sourceLabel: node.data.label,
          urn: node.data.assetRef ?? node.data.datahubUrn!,
          policy: parseLiveMonitorPolicy(monitor.data.rule),
        }]
      }
      queue.push(...(incoming.get(current) ?? []))
    }
    return []
  })
}
