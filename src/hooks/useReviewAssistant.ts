import type { Edge } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { buildReviewAssistantRequest } from '../domain/agent-context'
import type { ActiveAiSource } from '../domain/ai'
import { recordDiagnostic } from '../domain/diagnostics'
import type { IncidentSummary } from '../domain/incidents'
import type { AgentProposal, PipelineNode } from '../domain/pipeline'
import { errorMessage, notifyError } from '../domain/toasts'
import type { PipelineVersion } from '../domain/versioning'
import type { ValidationIssue } from '../validation/types'

interface AssistantAnswer {
  summary: string
  rationale: string
  evidence: string[]
  model: string
}

export function useReviewAssistant(options: {
  active: { connected: boolean; label: string; model: string }
  activeAiSource: ActiveAiSource
  edges: Edge[]
  incidentSummaries: IncidentSummary[]
  issues: ValidationIssue[]
  language: 'en' | 'fr'
  nodes: PipelineNode[]
  openAiSettings(): void
  proposal?: AgentProposal
  setActivity(value: string): void
  versions: PipelineVersion[]
}) {
  const runId = useRef(0)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AssistantAnswer>()

  useEffect(() => {
    setAnswer(undefined)
    setBusy(false)
    runId.current += 1
  }, [options.proposal?.id])

  const stop = () => {
    runId.current += 1
    setBusy(false)
    options.setActivity('Human Review assistant stopped · proposal and graph unchanged')
    if (window.dataLab) void window.dataLab.cancelAiProposal()
    if (window.dataLab) void window.dataLab.cancelChatGPTProposal()
  }

  const ask = async (question: string) => {
    if (!options.proposal || busy || !window.dataLab) return
    if (!options.active.connected) {
      options.openAiSettings()
      options.setActivity(`${options.active.label} is not connected · Human Review remains fully manual`)
      return
    }
    const currentRun = ++runId.current
    setBusy(true)
    options.setActivity(`${options.active.model} is reading the pending review · read-only assistant turn…`)
    try {
      const payload = buildReviewAssistantRequest({
        edges: options.edges,
        incidentContext: options.incidentSummaries,
        issues: options.issues,
        nodes: options.nodes,
        proposal: options.proposal,
        question,
        responseLanguage: options.language === 'fr' ? 'French' : 'English',
        versions: options.versions,
      })
      const response = options.activeAiSource === 'chatgpt'
        ? await window.dataLab.runChatGPTProposal(payload)
        : await window.dataLab.runAiProposal(payload)
      if (runId.current !== currentRun) return
      setAnswer({
        summary: response.proposal.summary,
        rationale: response.proposal.rationale,
        evidence: response.proposal.evidence,
        model: response.model,
      })
      options.setActivity(`${response.model} answered the reviewer · zero graph actions accepted`)
      recordDiagnostic({ category: 'provider', action: 'review.assistant', status: 'success', detail: { source: options.activeAiSource, model: response.model, actionCount: response.proposal.actions.length } })
    } catch (error) {
      if (runId.current !== currentRun) return
      notifyError(error, 'Human Review assistant failed')
      options.setActivity(`Human Review assistant failed · ${errorMessage(error, 'Unknown provider error')} · proposal unchanged`)
      recordDiagnostic({ category: 'provider', action: 'review.assistant', status: 'error', detail: { source: options.activeAiSource, message: errorMessage(error) } })
    } finally {
      if (runId.current === currentRun) setBusy(false)
    }
  }

  return { answer, ask, busy, stop }
}
