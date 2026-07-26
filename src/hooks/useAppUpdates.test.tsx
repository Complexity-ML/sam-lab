// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateStatus } from '../domain/updates'
import { useAppUpdates } from './useAppUpdates'

afterEach(() => { delete window.dataLab })

const ready: AppUpdateStatus = {
  currentVersion: '0.1.0', channel: 'stable', phase: 'ready', currentSignatureVerified: true,
  downloadedSignatureEnforced: true, canCheck: true, canDownload: false, canInstall: false,
  message: 'Ready to check for signed updates.',
}

describe('application update renderer bridge', () => {
  it('loads status, subscribes and changes channel only through explicit user action', async () => {
    const setAppUpdateChannel = vi.fn(async () => ({ ...ready, channel: 'main' as const }))
    let listener: ((status: AppUpdateStatus) => void) | undefined
    window.dataLab = {
      getAppUpdateStatus: vi.fn(async () => ready),
      setAppUpdateChannel,
      onAppUpdateStatusChanged: vi.fn((callback) => { listener = callback; return () => { listener = undefined } }),
    } as unknown as NonNullable<typeof window.dataLab>

    const report = vi.fn()
    const { result } = renderHook(() => useAppUpdates(report))
    await waitFor(() => expect(result.current.status.phase).toBe('ready'))
    expect(setAppUpdateChannel).not.toHaveBeenCalled()

    await act(() => result.current.setChannel('main'))
    expect(setAppUpdateChannel).toHaveBeenCalledWith('main')
    expect(result.current.status.channel).toBe('main')

    act(() => listener?.({ ...ready, phase: 'available', availableVersion: '0.2.0', canCheck: false, canDownload: true }))
    expect(result.current.status.availableVersion).toBe('0.2.0')
  })
})
