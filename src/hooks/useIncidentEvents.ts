import { useCallback, useEffect, useMemo, useState } from 'react'
import { summarizeIncidentEvents, type IncidentEvent, type IncidentEventInput } from '../domain/incidents'

export function useIncidentEvents(activeWorkspaceId?: string | null) {
  const [events, setEvents] = useState<IncidentEvent[]>([])

  useEffect(() => {
    let current = true
    if (!activeWorkspaceId || !window.dataLab?.listIncidentEvents) {
      setEvents([])
      return () => { current = false }
    }
    setEvents([])
    void window.dataLab.listIncidentEvents()
      .then((next) => { if (current) setEvents(next) })
      .catch(() => undefined)
    return () => { current = false }
  }, [activeWorkspaceId])

  const record = useCallback(async (event: IncidentEventInput) => {
    if (!activeWorkspaceId || !window.dataLab?.recordIncidentEvent) return
    const result = await window.dataLab.recordIncidentEvent(event).catch(() => ({ recorded: false as const }))
    if (result.recorded && result.event) setEvents((current) => [result.event!, ...current.filter((candidate) => candidate.id !== result.event!.id)].slice(0, 200))
  }, [activeWorkspaceId])

  const summaries = useMemo(() => summarizeIncidentEvents(events), [events])
  return { events, record, setEvents, summaries }
}
