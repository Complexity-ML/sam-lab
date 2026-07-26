// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiStatus, ChatGPTSessionStatus } from '../domain/ai'
import { disconnectedAiStatus, observeChatGPTConnection, useAiConnections } from './useAiConnections'

afterEach(() => { delete window.dataLab })

const connectedChatGPT: ChatGPTSessionStatus = { available: true, connected: true, selectedModel: 'gpt-5.6-sol' }

describe('active AI source recovery', () => {
  it('observes an authenticated account before the original login request returns', async () => {
    let readCount = 0
    const connect = vi.fn(() => new Promise<ChatGPTSessionStatus>(() => undefined))
    const readStatus = vi.fn(async () => {
      readCount += 1
      return readCount === 2 ? connectedChatGPT : { available: true, connected: false }
    })
    const observed = vi.fn()

    const result = await observeChatGPTConnection(connect, readStatus, observed, async () => undefined)

    expect(result).toEqual(connectedChatGPT)
    expect(readStatus).toHaveBeenCalledTimes(2)
    expect(observed).toHaveBeenLastCalledWith(connectedChatGPT, 2)
  })

  it('activates an already connected ChatGPT account when the saved API source is offline', async () => {
    const setActiveAiSource = vi.fn(async (source: 'chatgpt') => ({ source }))
    window.dataLab = {
      getAiStatus: vi.fn(async () => disconnectedAiStatus as AiStatus),
      getChatGPTStatus: vi.fn(async () => connectedChatGPT),
      getActiveAiSource: vi.fn(async () => ({ source: 'openai' as const })),
      setActiveAiSource,
    } as unknown as NonNullable<typeof window.dataLab>

    const { result } = renderHook(() => useAiConnections(vi.fn()))

    await waitFor(() => expect(result.current.activeAiSource).toBe('chatgpt'))
    expect(result.current.active.connected).toBe(true)
    expect(setActiveAiSource).toHaveBeenCalledWith('chatgpt')
  })

  it('selects ChatGPT immediately after a successful sign-in', async () => {
    const setActiveAiSource = vi.fn(async (source: 'chatgpt') => ({ source }))
    window.dataLab = {
      getAiStatus: vi.fn(async () => disconnectedAiStatus as AiStatus),
      getChatGPTStatus: vi.fn(async () => ({ available: true, connected: false })),
      getActiveAiSource: vi.fn(async () => ({ source: 'openai' as const })),
      connectChatGPT: vi.fn(async () => connectedChatGPT),
      setActiveAiSource,
    } as unknown as NonNullable<typeof window.dataLab>

    const { result } = renderHook(() => useAiConnections(vi.fn()))
    await act(() => result.current.connectChatGPT())
    await waitFor(() => expect(result.current.activeAiSource).toBe('chatgpt'))
    expect(setActiveAiSource).toHaveBeenCalledWith('chatgpt')
  })

  it('refreshes the account immediately after cancelling sign-in', async () => {
    const cancelChatGPTLogin = vi.fn(async () => ({ cancelled: true }))
    window.dataLab = {
      getAiStatus: vi.fn(async () => disconnectedAiStatus as AiStatus),
      getChatGPTStatus: vi.fn(async () => ({ available: true, connected: false })),
      getActiveAiSource: vi.fn(async () => ({ source: 'openai' as const })),
      cancelChatGPTLogin,
    } as unknown as NonNullable<typeof window.dataLab>

    const activity = vi.fn()
    const { result } = renderHook(() => useAiConnections(activity))
    await act(() => result.current.cancelChatGPTLogin())

    expect(cancelChatGPTLogin).toHaveBeenCalledTimes(1)
    expect(result.current.chatGPTStatus.connected).toBe(false)
    expect(activity).toHaveBeenCalledWith('ChatGPT sign-in cancelled · you can retry safely')
  })
})
