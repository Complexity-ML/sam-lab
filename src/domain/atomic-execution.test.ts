import { describe, expect, it } from 'vitest'
import { applyAtomicRunState, buildAtomicRunTrace, executePipelineAtomically, isAtomicExecutionCheckpointCurrent, resumePipelineAtomically } from './atomic-execution'
import { customerActivationEdges, customerActivationNodes, newCard } from './pipeline'

describe('atomic pipeline execution state machine', () => {
  it('does not start an empty graph', () => {
    expect(executePipelineAtomically([], [])).toMatchObject({ started: false, state: 'idle', events: [] })
  })

  it('commits cards only after every predecessor completed and reports split outputs independently', () => {
    const run = executePipelineAtomically(customerActivationNodes, customerActivationEdges)
    const completedSequence = new Map(run.events.filter((event) => event.state === 'completed').map((event) => [event.nodeId, event.sequence]))
    for (const edge of customerActivationEdges) expect(completedSequence.get(edge.source)!).toBeLessThan(completedSequence.get(edge.target)!)
    expect(run).toMatchObject({ state: 'completed', branches: expect.arrayContaining([{ outputId: 'activation-output', state: 'completed' }, { outputId: 'quarantine-output', state: 'completed' }]) })
  })

  it('pauses only the Human Review branch while another split branch completes', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const split = { ...newCard('split', 1), id: 'split' }
    const review = { ...newCard('review', 2), id: 'review' }
    const reviewedOutput = { ...newCard('output', 3), id: 'reviewed-output' }
    const directOutput = { ...newCard('output', 4), id: 'direct-output' }
    const run = executePipelineAtomically([source, split, review, reviewedOutput, directOutput], [
      { id: 'source-split', source: 'source', target: 'split' },
      { id: 'split-review', source: 'split', target: 'review', sourceHandle: 'approved' },
      { id: 'review-output', source: 'review', target: 'reviewed-output' },
      { id: 'split-direct', source: 'split', target: 'direct-output', sourceHandle: 'quarantine' },
    ])
    expect(run.state).toBe('waiting')
    expect(run.branches).toEqual(expect.arrayContaining([{ outputId: 'reviewed-output', state: 'waiting' }, { outputId: 'direct-output', state: 'completed' }]))
  })

  it('resumes only the reviewed branch from its checkpoint without replaying completed cards', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const split = { ...newCard('split', 1), id: 'split' }
    const review = { ...newCard('review', 2), id: 'review' }
    const reviewedOutput = { ...newCard('output', 3), id: 'reviewed-output' }
    const directOutput = { ...newCard('output', 4), id: 'direct-output' }
    const graphNodes = [source, split, review, reviewedOutput, directOutput]
    const graphEdges = [
      { id: 'source-split', source: 'source', target: 'split' },
      { id: 'split-review', source: 'split', target: 'review', sourceHandle: 'approved' },
      { id: 'review-output', source: 'review', target: 'reviewed-output' },
      { id: 'split-direct', source: 'split', target: 'direct-output', sourceHandle: 'quarantine' },
    ]
    const waiting = executePipelineAtomically(graphNodes, graphEdges)
    const completedBeforeResume = new Map(
      waiting.events
        .filter((event) => event.state === 'completed')
        .map((event) => [event.nodeId, event.sequence]),
    )

    const resumed = resumePipelineAtomically(graphNodes, graphEdges, waiting, { review: 'approved' })

    expect(resumed.state).toBe('completed')
    expect(resumed.branches).toEqual(expect.arrayContaining([
      { outputId: 'reviewed-output', state: 'completed' },
      { outputId: 'direct-output', state: 'completed' },
    ]))
    for (const [nodeId, sequence] of completedBeforeResume) {
      expect(resumed.events.filter((event) => event.nodeId === nodeId && event.state === 'completed')).toHaveLength(1)
      expect(resumed.events.find((event) => event.nodeId === nodeId && event.state === 'completed')?.sequence).toBe(sequence)
    }
    expect(resumed.events.filter((event) => event.nodeId === 'review' && event.state === 'completed')).toHaveLength(1)
    expect(resumed.events.filter((event) => event.nodeId === 'reviewed-output' && event.state === 'completed')).toHaveLength(1)
  })

  it('does not pause again at a durable Human Review checkpoint that was already approved', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const review = { ...newCard('review', 1), id: 'review', data: { ...newCard('review', 1).data, runState: 'completed' as const } }
    const output = { ...newCard('output', 2), id: 'output' }
    const run = executePipelineAtomically([source, review, output], [
      { id: 'source-review', source: source.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ])
    expect(run.state).toBe('completed')
    expect(run.nodeStates.review).toBe('completed')
    expect(run.events.some((event) => event.nodeId === review.id && event.state === 'waiting')).toBe(false)
  })

  it('rejects only the waiting branch while preserving an already completed parallel branch', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const review = { ...newCard('review', 1), id: 'review' }
    const reviewedOutput = { ...newCard('output', 2), id: 'reviewed-output' }
    const directOutput = { ...newCard('output', 3), id: 'direct-output' }
    const graphNodes = [source, review, reviewedOutput, directOutput]
    const graphEdges = [
      { id: 'source-review', source: 'source', target: 'review' },
      { id: 'review-output', source: 'review', target: 'reviewed-output' },
      { id: 'source-direct', source: 'source', target: 'direct-output' },
    ]
    const waiting = executePipelineAtomically(graphNodes, graphEdges)
    const resumed = resumePipelineAtomically(graphNodes, graphEdges, waiting, { review: 'rejected' })

    expect(resumed.state).toBe('failed')
    expect(resumed.nodeStates).toMatchObject({
      review: 'failed',
      'reviewed-output': 'failed',
      'direct-output': 'completed',
    })
    expect(resumed.events.filter((event) => event.nodeId === 'direct-output' && event.state === 'completed')).toHaveLength(1)
  })

  it('stops before a later card commit and never completes a terminal output', () => {
    const run = executePipelineAtomically(customerActivationNodes, customerActivationEdges, { shouldStop: (completed) => completed.length >= 2 })
    expect(run.state).toBe('stopped')
    expect(run.nodeStates['activation-output']).toBe('stopped')
    expect(run.events.some((event) => event.nodeId === 'activation-output' && event.state === 'completed')).toBe(false)
  })

  it('replays multiple scoped Impact Analysis atoms independently', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const featureImpact = { ...newCard('impact', 1), id: 'feature-impact' }
    const modelImpact = { ...newCard('impact', 2), id: 'model-impact' }
    const output = { ...newCard('output', 3), id: 'output' }
    const graphEdges = [{ id: 'e-1', source: source.id, target: featureImpact.id }, { id: 'e-2', source: featureImpact.id, target: modelImpact.id }, { id: 'e-3', source: modelImpact.id, target: output.id }]
    const first = executePipelineAtomically([source, featureImpact, modelImpact, output], graphEdges)
    const replay = executePipelineAtomically([source, featureImpact, modelImpact, output], graphEdges)
    expect(first.nodeStates).toMatchObject({ 'feature-impact': 'completed', 'model-impact': 'completed' })
    expect(replay.nodeStates).toEqual(first.nodeStates)
    expect(replay.events.filter((event) => event.message.startsWith('Impact Analysis atom'))).toHaveLength(2)
  })

  it('treats Output feedback as a next-iteration boundary instead of an in-run cycle', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const monitor = { ...newCard('monitor', 1), id: 'monitor' }
    const output = { ...newCard('output', 2), id: 'output' }
    const run = executePipelineAtomically([source, monitor, output], [
      { id: 'source-monitor', source: source.id, target: monitor.id },
      { id: 'monitor-output', source: monitor.id, target: output.id },
      { id: 'output-feedback', source: output.id, target: monitor.id, sourceHandle: 'feedback' },
    ])
    expect(run.state).toBe('completed')
    expect(run.nodeStates).toMatchObject({ source: 'completed', monitor: 'completed', output: 'completed' })
    expect(run.events.some((event) => event.message.startsWith('Live Monitor'))).toBe(true)
  })

  it('materializes inspectable card states and a deterministic review trace', () => {
    const run = executePipelineAtomically(customerActivationNodes, customerActivationEdges)
    const rendered = applyAtomicRunState(customerActivationNodes, run)
    expect(rendered.find((node) => node.id === 'customers-source')?.data).toMatchObject({ runState: 'completed', runSequence: 2 })
    expect(buildAtomicRunTrace(customerActivationNodes, run).at(-1)).toMatchObject({ nodeId: 'quarantine-output', state: 'completed' })
  })

  it('uses a durable build-in-progress checkpoint instead of replaying an unchanged graph', () => {
    const first = executePipelineAtomically(customerActivationNodes, customerActivationEdges)
    const checkpointed = applyAtomicRunState(customerActivationNodes, first)
    const replay = executePipelineAtomically(checkpointed, customerActivationEdges)

    expect(replay.state).toBe('completed')
    expect(replay.events).toEqual([])
    expect(isAtomicExecutionCheckpointCurrent(replay)).toBe(true)
    expect(applyAtomicRunState(checkpointed, replay).map((node) => node.data.runSequence))
      .toEqual(checkpointed.map((node) => node.data.runSequence))
  })

  it('replays only an edited card and its descendants while preserving independent completed cards', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const analysis = { ...newCard('analysis', 1), id: 'analysis' }
    const output = { ...newCard('output', 2), id: 'output' }
    const independent = { ...newCard('control', 3), id: 'controller' }
    const graphEdges = [
      { id: 'source-analysis', source: source.id, target: analysis.id },
      { id: 'analysis-output', source: analysis.id, target: output.id },
    ]
    const first = executePipelineAtomically([source, analysis, output, independent], graphEdges)
    const checkpointed = applyAtomicRunState([source, analysis, output, independent], first)
    const edited = checkpointed.map((node) => node.id === analysis.id
      ? { ...node, data: { ...node.data, description: 'A newly versioned analysis contract.' } }
      : node)
    const resumed = executePipelineAtomically(edited, graphEdges)
    const completedAgain = resumed.events.filter((event) => event.state === 'completed').map((event) => event.nodeId)

    expect(completedAgain).toEqual(['analysis', 'output'])
    expect(resumed.nodeStates).toMatchObject({
      source: 'completed',
      analysis: 'completed',
      output: 'completed',
      controller: 'completed',
    })
    expect(completedAgain).not.toContain('source')
    expect(completedAgain).not.toContain('controller')
  })

  it('invalidates a target when its incoming connection changes', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const validation = { ...newCard('validation', 1), id: 'validation' }
    const output = { ...newCard('output', 2), id: 'output' }
    const firstEdges = [{ id: 'source-output', source: source.id, target: output.id }]
    const first = executePipelineAtomically([source, validation, output], firstEdges)
    const checkpointed = applyAtomicRunState([source, validation, output], first)
    const nextEdges = [
      { id: 'source-validation', source: source.id, target: validation.id },
      { id: 'validation-output', source: validation.id, target: output.id },
    ]
    const resumed = executePipelineAtomically(checkpointed, nextEdges)
    const completedAgain = resumed.events.filter((event) => event.state === 'completed').map((event) => event.nodeId)

    expect(completedAgain).toEqual(['validation', 'output'])
    expect(completedAgain).not.toContain('source')
  })

  it('does not apply an old Human Review decision after its upstream contract changes', () => {
    const source = { ...newCard('source', 0), id: 'source' }
    const review = { ...newCard('review', 1), id: 'review' }
    const output = { ...newCard('output', 2), id: 'output' }
    const graphEdges = [
      { id: 'source-review', source: source.id, target: review.id },
      { id: 'review-output', source: review.id, target: output.id },
    ]
    const waiting = executePipelineAtomically([source, review, output], graphEdges)
    const changed = [source, review, output].map((node) => node.id === source.id
      ? { ...node, data: { ...node.data, description: 'Changed after the review request.' } }
      : node)
    const resumed = resumePipelineAtomically(changed, graphEdges, waiting, { review: 'approved' })

    expect(resumed.state).toBe('waiting')
    expect(resumed.nodeStates).toMatchObject({ source: 'completed', review: 'waiting', output: 'idle' })
    expect(resumed.events.at(-1)).toMatchObject({ nodeId: 'review', state: 'waiting' })
  })
})
