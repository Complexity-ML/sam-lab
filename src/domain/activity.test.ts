import { describe, expect, it } from 'vitest'
import { isAgentActionActivity } from './activity'

describe('agent action activity', () => {
  it('keeps scheduler, provider and terminal graph transitions together', () => {
    expect(isAgentActionActivity('Next autonomous iteration scheduled · rereading the graph and checkpoint…')).toBe(true)
    expect(isAgentActionActivity('gpt-5.6-sol is analyzing the graph and previous versions…')).toBe(true)
    expect(isAgentActionActivity('Graph is already current · no duplicate revision created · Live Monitor remains armed')).toBe(true)
    expect(isAgentActionActivity('Catalog checkpoint 67/67 complete · model call boundary reached')).toBe(true)
  })

  it('leaves unrelated interface messages in the complete live log only', () => {
    expect(isAgentActionActivity('Canvas fitted to the current graph')).toBe(true)
    expect(isAgentActionActivity('Theme changed to dark')).toBe(false)
    expect(isAgentActionActivity('Workspace renamed · Customer pipeline')).toBe(false)
  })
})
