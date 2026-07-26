import { describe, expect, it } from 'vitest'
import { createGraphHistory, recordGraphSnapshot, redoGraphHistory, undoGraphHistory, type GraphSnapshot } from './graph-history'

const snapshot = (id: string): GraphSnapshot => ({ nodes: [{ id, type: 'pipeline', position: { x: 0, y: 0 }, data: { kind: 'source', label: id, description: '', owner: '', status: 'draft', schema: [] } }], edges: [] })

describe('graph undo and redo history', () => {
  it('travels through graph snapshots and discards redo after a new edit', () => {
    let history = createGraphHistory(snapshot('a'))
    history = recordGraphSnapshot(history, snapshot('b'))
    history = recordGraphSnapshot(history, snapshot('c'))
    const undone = undoGraphHistory(history)
    expect(undone.snapshot?.nodes[0].id).toBe('b')
    const redone = redoGraphHistory(undone.history)
    expect(redone.snapshot?.nodes[0].id).toBe('c')
    const branched = recordGraphSnapshot(undone.history, snapshot('d'))
    expect(redoGraphHistory(branched).snapshot).toBeUndefined()
  })

  it('bounds memory and ignores equivalent snapshots', () => {
    let history = createGraphHistory(snapshot('0'))
    history = recordGraphSnapshot(history, snapshot('0'))
    expect(history.entries).toHaveLength(1)
    for (let index = 1; index < 70; index += 1) history = recordGraphSnapshot(history, snapshot(String(index)), 50)
    expect(history.entries).toHaveLength(50)
  })
})
