import { describe, expect, it } from 'vitest'
import { proposalConnectionCompatibilityError } from '../../electron/proposal-contract'
import { canConnectCardKinds, cardCompatibility, cardConnectionError } from './card-compatibility'
import type { CardKind } from './pipeline'

const kinds: CardKind[] = ['control', 'explorer', 'worker', 'query', 'source', 'profile', 'analysis', 'impact', 'risk', 'patch', 'monitor', 'parallel', 'diagram', 'split', 'decision', 'transform', 'review', 'validation', 'output']

describe('card compatibility', () => {
  it('defines compatibility for every card kind', () => {
    expect(Object.keys(cardCompatibility).sort()).toEqual([...kinds].sort())
  })

  it('supports Query Check across reads, patches, risks and reviews', () => {
    expect(canConnectCardKinds('source', 'query')).toBe(true)
    expect(canConnectCardKinds('query', 'profile')).toBe(true)
    expect(canConnectCardKinds('patch', 'query')).toBe(true)
    expect(canConnectCardKinds('query', 'risk')).toBe(true)
    expect(canConnectCardKinds('query', 'review')).toBe(true)
  })

  it('keeps renderer and Electron proposal compatibility in exact parity', () => {
    const handles = [null, 'approved', 'quarantine', 'feedback'] as const
    for (const source of kinds) {
      for (const target of kinds) {
        for (const handle of handles) {
          expect(Boolean(proposalConnectionCompatibilityError(source, target, handle))).toBe(Boolean(cardConnectionError(source, target, handle)))
        }
      }
    }
  })

  it('rejects semantically invalid lineage shortcuts', () => {
    expect(canConnectCardKinds('profile', 'transform')).toBe(false)
    expect(canConnectCardKinds('risk', 'transform')).toBe(false)
    expect(canConnectCardKinds('validation', 'analysis')).toBe(false)
    expect(canConnectCardKinds('review', 'profile')).toBe(false)
  })

  it('keeps global cards outside lineage and preserves feedback semantics', () => {
    expect(cardConnectionError('control', 'source')).toMatch(/global policy/)
    expect(cardConnectionError('explorer', 'query')).toMatch(/sidecar/)
    expect(cardConnectionError('analysis', 'source')).toMatch(/begin/)
    expect(canConnectCardKinds('output', 'monitor', 'feedback')).toBe(true)
    expect(canConnectCardKinds('output', 'monitor')).toBe(false)
    expect(canConnectCardKinds('query', 'monitor', 'feedback')).toBe(false)
  })
})
