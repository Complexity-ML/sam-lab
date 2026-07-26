import { describe, expect, it } from 'vitest'
import { parseActiveAiSource, requireSelectableAiSource } from './active-ai-source.js'

const connected = { chatgpt: true, openai: true, anthropic: false, moonshot: false }

describe('active AI source', () => {
  it('accepts only the four explicit mutually exclusive sources', () => {
    expect(['chatgpt', 'openai', 'anthropic', 'moonshot'].map(parseActiveAiSource)).toEqual(['chatgpt', 'openai', 'anthropic', 'moonshot'])
    expect(parseActiveAiSource('automatic')).toBeUndefined()
  })

  it('prevents a disconnected source from becoming active', () => {
    expect(requireSelectableAiSource('chatgpt', connected)).toBe('chatgpt')
    expect(() => requireSelectableAiSource('anthropic', connected)).toThrow('Connect anthropic')
  })
})
