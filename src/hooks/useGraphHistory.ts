import type { Edge } from '@xyflow/react'
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { createGraphHistory, recordGraphSnapshot, redoGraphHistory, undoGraphHistory } from '../domain/graph-history'
import type { PipelineNode } from '../domain/pipeline'

interface GraphHistoryOptions {
  edges: Edge[]
  nodes: PipelineNode[]
  setActivity(message: string): void
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
}

export function useGraphHistory({ edges, nodes, setActivity, setEdges, setNodes }: GraphHistoryOptions) {
  const history = useRef(createGraphHistory({ edges, nodes }))
  const latest = useRef({ edges, nodes })
  const replaying = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  latest.current = { edges, nodes }

  const recordNow = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = undefined
    history.current = recordGraphSnapshot(history.current, latest.current)
  }, [])

  useEffect(() => {
    if (replaying.current) { replaying.current = false; return }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(recordNow, 280)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [edges, nodes, recordNow])

  const apply = (snapshot: { edges: Edge[]; nodes: PipelineNode[] } | undefined, message: string) => {
    if (!snapshot) { setActivity(`${message} unavailable · history boundary reached`); return false }
    replaying.current = true
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
    setActivity(`${message} applied · active graph updated locally`)
    return true
  }

  const undo = useCallback(() => {
    recordNow()
    const result = undoGraphHistory(history.current)
    history.current = result.history
    return apply(result.snapshot, 'Undo')
  }, [recordNow])

  const redo = useCallback(() => {
    const result = redoGraphHistory(history.current)
    history.current = result.history
    return apply(result.snapshot, 'Redo')
  }, [])

  return { redo, undo }
}
