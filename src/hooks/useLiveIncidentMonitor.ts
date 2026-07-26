import { useEffect, useMemo, useRef } from 'react'
import type { Edge } from '@xyflow/react'
import type { DataHubMcpAudit } from '../electron-api'
import type { IncidentEventInput } from '../domain/incidents'
import { errorMessage } from '../domain/toasts'
import {
  evaluateMonitorObservation,
  findBoundLiveMonitors,
  liveMonitorBindingKey,
  observeDataHubAudit,
  verifyPostCorrectionObservation,
  type BoundLiveMonitor,
  type MonitorObservation,
  type MonitorRuntimeState,
  type PostCorrectionVerification,
} from '../domain/live-monitor'
import type { PipelineNode } from '../domain/pipeline'
import { classifyConnectivityFailure } from '../domain/connectivity'

export interface LiveIncidentTrigger {
  audit: DataHubMcpAudit
  incidentKey: string
  monitor: BoundLiveMonitor
  observation: MonitorObservation
  reason: 'evidence-change' | 'verification-failed' | 'retry-exhausted'
  attempts: number
}

interface UseLiveIncidentMonitorOptions {
  active: boolean
  agentBlocked?: boolean
  agentBusy?: boolean
  reviewBlockedBranchId?: string
  nodes: PipelineNode[]
  edges: Edge[]
  audit(urn: string): Promise<DataHubMcpAudit>
  onIncident(event: IncidentEventInput): Promise<void>
  onTrigger(trigger: LiveIncidentTrigger): Promise<void>
  verificationRequests?: { current: Map<string, PostCorrectionVerification> }
}

export function useLiveIncidentMonitor({
  active,
  agentBlocked,
  agentBusy,
  reviewBlockedBranchId,
  nodes,
  edges,
  audit,
  onIncident,
  onTrigger,
  verificationRequests,
}: UseLiveIncidentMonitorOptions) {
  const monitors = useMemo(() => findBoundLiveMonitors(nodes, edges), [edges, nodes])
  const callbacks = useRef({ audit, onIncident, onTrigger })
  const busy = useRef(agentBusy ?? agentBlocked ?? false)
  const blockedReviewBranch = useRef(reviewBlockedBranchId)
  const runtime = useRef(new Map<string, MonitorRuntimeState>())
  const nextRead = useRef(new Map<string, number>())
  const reading = useRef(new Set<string>())
  const triggering = useRef(false)
  const pendingTriggers = useRef(new Map<string, LiveIncidentTrigger>())
  busy.current = agentBusy ?? agentBlocked ?? false
  blockedReviewBranch.current = reviewBlockedBranchId

  useEffect(() => { callbacks.current = { audit, onIncident, onTrigger } }, [audit, onIncident, onTrigger])

  useEffect(() => {
    if (!active) {
      pendingTriggers.current.clear()
      return
    }
    const activeBindings = new Set(monitors.map(liveMonitorBindingKey))
    for (const bindingKey of pendingTriggers.current.keys()) {
      if (!activeBindings.has(bindingKey)) pendingTriggers.current.delete(bindingKey)
    }
  }, [active, monitors])

  useEffect(() => {
    if (!active || monitors.length === 0) return
    let disposed = false

    const tick = async () => {
      const now = Date.now()
      let agentTriggered = false
      const triggerBlocked = (monitor: BoundLiveMonitor) => busy.current || blockedReviewBranch.current === monitor.monitorId
      const dispatchTrigger = async (bindingKey: string, trigger: LiveIncidentTrigger) => {
        if (triggerBlocked(trigger.monitor) || triggering.current || agentTriggered) {
          pendingTriggers.current.set(bindingKey, trigger)
          return
        }
        triggering.current = true
        agentTriggered = true
        try { await callbacks.current.onTrigger(trigger) }
        finally { triggering.current = false }
      }
      for (const monitor of monitors) {
        const bindingKey = liveMonitorBindingKey(monitor)
        if (disposed || reading.current.has(bindingKey) || (nextRead.current.get(bindingKey) ?? 0) > now) continue
        reading.current.add(bindingKey)
        nextRead.current.set(bindingKey, now + monitor.policy.cooldownMs)
        try {
          const auditResult = await callbacks.current.audit(monitor.urn)
          if (disposed) return
          const observation = observeDataHubAudit(auditResult)
          const verification = verificationRequests?.current.get(bindingKey)
          if (verification) {
            verificationRequests!.current.delete(bindingKey)
            const verified = verifyPostCorrectionObservation(runtime.current.get(bindingKey), observation, monitor.policy)
            runtime.current.set(bindingKey, verified.next)
            await callbacks.current.onIncident({
              incidentKey: verification.incidentKey,
              transition: verified.passed ? 'recovered' : 'worsened',
              severity: verified.passed ? 'info' : observation.severity,
              title: verified.passed
                ? `${monitor.monitorLabel} · correction verified`
                : `${monitor.monitorLabel} · correction verification failed`,
              detail: verified.passed
                ? `Version ${verification.versionId} passed an explicit fresh-evidence verification. The monitored condition returned to normal.`
                : `Version ${verification.versionId} was committed safely, but fresh evidence still reports: ${observation.reasons.join(' ') || 'the monitored condition remains abnormal.'}`,
              sourceSystem: 'DataHub',
              sourceRef: monitor.urn,
              fingerprint: observation.fingerprint,
              cardId: monitor.monitorId,
              branchId: monitor.monitorId,
              versionId: verification.versionId,
            })
            if (!verified.passed && (verified.triggerAgent || verified.escalateToHumanReview)) {
              await dispatchTrigger(bindingKey, {
                audit: auditResult,
                incidentKey: verification.incidentKey,
                monitor,
                observation,
                reason: verified.escalateToHumanReview ? 'retry-exhausted' : 'verification-failed',
                attempts: verified.next.iterations,
              })
            }
            continue
          }
          const decision = evaluateMonitorObservation(runtime.current.get(bindingKey), observation, monitor.policy)
          runtime.current.set(bindingKey, decision.next)
          if (!decision.transition) continue
          const incidentKey = `live-monitor:${monitor.monitorId}:${monitor.urn}`
          const failedReadSummaries = auditResult.reads.filter((read) => read.status !== 'ok' || read.stale).map((read) => read.summary)
          const connectivity = observation.failedReads === observation.totalReads
            ? classifyConnectivityFailure(failedReadSummaries.join(' | '), `DataHub · ${monitor.sourceLabel}`)
            : undefined
          const detail = decision.transition === 'recovered'
            ? `All ${observation.totalReads} monitored connector reads returned to normal.`
            : connectivity?.detail ?? `${observation.reasons.join(' ') || 'The evidence-backed risk state changed.'} Fingerprint ${observation.fingerprint}.`
          await callbacks.current.onIncident({
            incidentKey,
            transition: decision.transition,
            severity: observation.severity,
            title: connectivity?.title ?? `${monitor.monitorLabel} · ${monitor.sourceLabel}`,
            detail,
            sourceSystem: connectivity?.sourceSystem ?? 'DataHub',
            sourceRef: monitor.urn,
            fingerprint: observation.fingerprint,
            cardId: monitor.monitorId,
            branchId: monitor.monitorId,
          })
          if (decision.triggerAgent || decision.escalateToHumanReview) {
            await dispatchTrigger(bindingKey, {
              audit: auditResult,
              incidentKey,
              monitor,
              observation,
              reason: decision.escalateToHumanReview ? 'retry-exhausted' : 'evidence-change',
              attempts: decision.next.iterations,
            })
          }
        } catch (error) {
          if (!disposed) {
            const incidentKey = `live-monitor:${monitor.monitorId}:${monitor.urn}`
            const connectivity = classifyConnectivityFailure(error, `DataHub · ${monitor.sourceLabel}`)
            await callbacks.current.onIncident({
              incidentKey,
              transition: runtime.current.get(bindingKey)?.open ? 'worsened' : 'opened',
              severity: 'critical',
              title: connectivity?.title ?? `${monitor.monitorLabel} · monitoring unavailable`,
              detail: connectivity?.detail ?? errorMessage(error, 'Connector monitoring failed'),
              sourceSystem: connectivity?.sourceSystem ?? 'DataHub',
              sourceRef: monitor.urn,
              fingerprint: connectivity?.fingerprint ?? 'monitor-read-error',
              cardId: monitor.monitorId,
              branchId: monitor.monitorId,
            })
            runtime.current.set(bindingKey, { fingerprint: connectivity?.fingerprint ?? 'monitor-read-error', severity: 'critical', open: true, iterations: (runtime.current.get(bindingKey)?.iterations ?? 0) + 1 })
          }
        } finally {
          reading.current.delete(bindingKey)
        }
      }
      if (!disposed && !busy.current && !triggering.current && !agentTriggered) {
        const deferred = [...pendingTriggers.current.entries()]
          .find(([, trigger]) => blockedReviewBranch.current !== trigger.monitor.monitorId)
        if (deferred) {
          const [bindingKey, trigger] = deferred
          pendingTriggers.current.delete(bindingKey)
          triggering.current = true
          try { await callbacks.current.onTrigger(trigger) }
          finally { triggering.current = false }
        }
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 2_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [active, monitors])
}
