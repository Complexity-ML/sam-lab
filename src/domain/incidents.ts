export type IncidentTransition = 'opened' | 'worsened' | 'agent-action' | 'human-review' | 'recovered'
export type IncidentSeverity = 'info' | 'warning' | 'critical'

export interface IncidentEventInput {
  incidentKey: string
  transition: IncidentTransition
  severity: IncidentSeverity
  title: string
  detail: string
  sourceSystem?: string
  sourceRef?: string
  fingerprint?: string
  cardId?: string
  branchId?: string
  versionId?: string
}

export interface IncidentEvent extends IncidentEventInput {
  id: string
  workspaceId?: string
  createdAt: string
}

export interface IncidentRecordResult {
  recorded: boolean
  event?: IncidentEvent
}

export type IncidentStatus = 'open' | 'investigating' | 'waiting-review' | 'mitigating' | 'resolved'

export interface IncidentSummary {
  incidentKey: string
  status: IncidentStatus
  severity: IncidentSeverity
  title: string
  detail: string
  openedAt: string
  updatedAt: string
  resolvedAt?: string
  sourceSystem?: string
  sourceRef?: string
  fingerprint?: string
  occurrenceCount: number
  eventCount: number
  cardId?: string
  branchId?: string
  versionId?: string
}

const severityRank: Record<IncidentSeverity, number> = { info: 0, warning: 1, critical: 2 }

function transitionStatus(transition: IncidentTransition): IncidentStatus {
  if (transition === 'human-review') return 'waiting-review'
  if (transition === 'agent-action') return 'mitigating'
  if (transition === 'recovered') return 'resolved'
  if (transition === 'worsened') return 'investigating'
  return 'open'
}

export function summarizeIncidentEvents(events: IncidentEvent[]): IncidentSummary[] {
  const grouped = new Map<string, IncidentEvent[]>()
  for (const event of events) {
    const group = grouped.get(event.incidentKey) ?? []
    group.push(event)
    grouped.set(event.incidentKey, group)
  }

  return [...grouped.entries()].map(([incidentKey, group]) => {
    const ordered = [...group].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const latest = ordered.at(-1)!
    let occurrenceCount = 0
    let wasResolved = true
    let openedAt = ordered[0].createdAt
    let peakSeverity: IncidentSeverity = 'info'
    for (const event of ordered) {
      if (event.transition === 'opened' && wasResolved) {
        occurrenceCount += 1
        openedAt = event.createdAt
      }
      wasResolved = event.transition === 'recovered'
      if (!wasResolved && severityRank[event.severity] > severityRank[peakSeverity]) peakSeverity = event.severity
      if (wasResolved) peakSeverity = 'info'
    }
    return {
      incidentKey,
      status: transitionStatus(latest.transition),
      severity: latest.transition === 'recovered' ? 'info' : severityRank[latest.severity] >= severityRank[peakSeverity] ? latest.severity : peakSeverity,
      title: latest.title,
      detail: latest.detail,
      openedAt,
      updatedAt: latest.createdAt,
      resolvedAt: latest.transition === 'recovered' ? latest.createdAt : undefined,
      sourceSystem: latest.sourceSystem,
      sourceRef: latest.sourceRef,
      fingerprint: latest.fingerprint,
      occurrenceCount: Math.max(1, occurrenceCount),
      eventCount: ordered.length,
      cardId: latest.cardId,
      branchId: latest.branchId,
      versionId: latest.versionId,
    }
  }).sort((left, right) => {
    if (left.status === 'resolved' && right.status !== 'resolved') return 1
    if (left.status !== 'resolved' && right.status === 'resolved') return -1
    if (severityRank[left.severity] !== severityRank[right.severity]) return severityRank[right.severity] - severityRank[left.severity]
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}
