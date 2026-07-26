import { describe, expect, it } from 'vitest'
import { AgentToolSession } from './agent-tools.js'
import { chatGPTDynamicTools, dynamicToolCallResponse, loginCompletionState, turnActivityState } from './chatgpt-session.js'

describe('ChatGPT Codex dynamic SAM LAB tools', () => {
  it('maps the shared strict tool surface to App Server dynamic tools', () => {
    expect(chatGPTDynamicTools.map((tool) => tool.name)).toContain('finish_plan')
    expect(chatGPTDynamicTools.map((tool) => tool.name)).toContain('read_catalog_checkpoint')
    expect(chatGPTDynamicTools.find((tool) => tool.name === 'connect_cards')).toMatchObject({
      type: 'function',
      inputSchema: { type: 'object', additionalProperties: false },
    })
  })

  it('returns an App Server content item from the same bounded host session', () => {
    const session = new AgentToolSession({ graph: { nodes: [], edges: [] } })
    const response = dynamicToolCallResponse(session, {
      threadId: 'thread-1',
      tool: 'list_card_kinds',
      arguments: {},
    })
    expect(response.success).toBe(true)
    expect(response.contentItems[0]).toMatchObject({ type: 'inputText' })
    expect(JSON.parse(response.contentItems[0].text)).toMatchObject({ ok: true, status: 'read' })
  })

  it('accepts the current login completion shapes and ignores another login', () => {
    expect(loginCompletionState('account/login/completed', { loginId: 'login-1', success: true, error: null }, 'login-1')).toEqual({ success: true, error: undefined })
    expect(loginCompletionState('account/login/completed', { loginId: null, success: false, error: 'cancelled' }, 'login-1')).toEqual({ success: false, error: 'cancelled' })
    expect(loginCompletionState('account/updated', { authMode: 'chatgpt' }, 'login-1')).toEqual({ success: true })
    expect(loginCompletionState('account/login/completed', { loginId: 'login-2', success: true }, 'login-1')).toBeUndefined()
  })

  it('renews only the active turn deadline and completes on its terminal event', () => {
    expect(turnActivityState('item/agentMessage/delta', { threadId: 'thread-1', delta: 'working' }, 'thread-1')).toBe('activity')
    expect(turnActivityState('item/completed', { threadId: 'thread-1' }, 'thread-1')).toBe('activity')
    expect(turnActivityState('turn/completed', { threadId: 'thread-1' }, 'thread-1')).toBe('complete')
    expect(turnActivityState('turn/completed', { threadId: 'thread-2' }, 'thread-1')).toBe('ignore')
  })
})
