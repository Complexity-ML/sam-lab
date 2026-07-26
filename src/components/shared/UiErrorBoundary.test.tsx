// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiErrorBoundary } from './UiErrorBoundary'

afterEach(() => { cleanup(); delete window.dataLab })

describe('UiErrorBoundary', () => {
  it('keeps a recovery shell usable and exposes retry, logs and restart', async () => {
    const user = userEvent.setup()
    let failing = true
    const Broken = () => { if (failing) throw new Error('Renderer failed safely'); return <p>Recovered interface</p> }
    const openDiagnosticLogs = vi.fn(async () => ({ opened: true as const, path: '/tmp/log' }))
    const restartApplication = vi.fn(async () => ({ restarting: true as const }))
    window.dataLab = { openDiagnosticLogs, restartApplication, recordDiagnostic: vi.fn(async (event) => ({ ...event, id: 'event', timestamp: new Date().toISOString() })) } as unknown as NonNullable<typeof window.dataLab>
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<UiErrorBoundary><Broken /></UiErrorBoundary>)

    expect(screen.getByRole('heading', { name: 'SAM LAB kept your last safe workspace' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Open local logs' }))
    await user.click(screen.getByRole('button', { name: 'Restart SAM LAB' }))
    expect(openDiagnosticLogs).toHaveBeenCalled()
    expect(restartApplication).toHaveBeenCalled()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Retry interface' }))
    expect(await screen.findByText('Recovered interface')).toBeTruthy()
    consoleError.mockRestore()
  })
})
