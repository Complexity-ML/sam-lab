import { describe, expect, it } from 'vitest'
import { materializeAiProposal, type AiProposalResponse } from './ai'
import type { PipelineNode } from './pipeline'

describe('AI proposal materialization', () => {
  it('completes a bounded Live Monitor contract before graph validation', () => {
    const response: AiProposalResponse = {
      model: 'test-model',
      proposal: {
        title: 'Monitor governed metadata',
        summary: 'Add a bounded monitor.',
        rationale: 'Continuous evidence needs a safe polling contract.',
        requires_human_review: false,
        confidence: 0.95,
        writeback: 'none',
        evidence: [],
        actions: [{
          type: 'add_card',
          node_id: 'monitor-orders',
          kind: 'monitor',
          label: 'Watch orders',
          description: 'Watch metadata changes.',
          owner: 'SAM LAB Agent',
          rule: 'alert=severity_increase',
          source: null,
          target: null,
          source_handle: null,
          reason: 'Monitor the governed source.',
        }],
      },
    }

    const monitor = materializeAiProposal(response, [], []).addedNodes[0]
    expect(monitor?.data.rule).toContain('alert=severity_increase')
    expect(monitor?.data.rule).toContain('on_change(metadata_fingerprint)')
    expect(monitor?.data.rule).toContain('cooldown=60s')
    expect(monitor?.data.rule).toContain('max_iterations=10')
  })

  it('deduplicates minute-based Live Monitor cooldowns', () => {
    const response: AiProposalResponse = {
      model: 'test-model',
      proposal: {
        title: 'Monitor governed metadata',
        summary: 'Use one bounded cadence.',
        rationale: 'The first explicit cooldown remains authoritative.',
        requires_human_review: false,
        confidence: 0.95,
        writeback: 'none',
        evidence: [],
        actions: [{
          type: 'add_card',
          node_id: 'monitor-orders',
          kind: 'monitor',
          label: 'Watch orders',
          description: 'Watch metadata changes.',
          owner: 'SAM LAB Agent',
          rule: 'on_change(metadata_fingerprint) | cooldown=30m | max_iterations=1 | cooldown=60s',
          source: null,
          target: null,
          source_handle: null,
          reason: 'Monitor the governed source.',
        }],
      },
    }

    const rule = materializeAiProposal(response, [], []).addedNodes[0]?.data.rule ?? ''
    expect(rule).toContain('cooldown=30m')
    expect(rule.match(/cooldown=/g)).toHaveLength(1)
  })

  it('accepts an update to an existing Human Review checkpoint', () => {
    const review: PipelineNode = {
      id: 'review-existing',
      type: 'pipeline',
      position: { x: 0, y: 0 },
      data: { kind: 'review', label: 'Review', description: '', owner: 'Data', status: 'healthy', schema: [] },
    }
    const response: AiProposalResponse = {
      model: 'test-model',
      proposal: {
        title: 'Clarify the checkpoint',
        summary: 'Update the existing checkpoint without creating a duplicate.',
        rationale: 'The review already exists.',
        requires_human_review: true,
        confidence: 0.9,
        writeback: 'none',
        evidence: [],
        actions: [{
          type: 'update_card',
          node_id: review.id,
          kind: null,
          label: 'Review corrected mapping',
          description: null,
          owner: null,
          rule: null,
          source: null,
          target: null,
          source_handle: null,
          reason: 'Clarify the existing Human Review.',
        }],
      },
    }

    expect(materializeAiProposal(response, [review], []).updatedNodes).toMatchObject([
      { nodeId: review.id, patch: { label: 'Review corrected mapping' } },
    ])
  })
})
