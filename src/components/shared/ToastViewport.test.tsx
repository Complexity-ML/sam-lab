// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { notifyError } from '../../domain/toasts'
import { ToastViewport } from './ToastViewport'

afterEach(cleanup)

describe('ToastViewport', () => {
  it('shows, deduplicates and dismisses caught UI errors', () => {
    render(<ToastViewport />)

    act(() => {
      notifyError(new Error('DataHub connection timed out'))
      notifyError(new Error('DataHub connection timed out'))
    })

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByText('DataHub connection timed out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('DataHub connection timed out')).toBeNull()
  })

  it('catches global browser errors', () => {
    render(<ToastViewport />)
    act(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Renderer exploded' })))

    expect(screen.getByText('Interface error')).toBeTruthy()
    expect(screen.getByText('Renderer exploded')).toBeTruthy()
  })

  it('replaces minified bundle fragments with a readable diagnostic handoff', () => {
    render(<ToastViewport />)
    act(() => notifyError(new Error(`var Au=function(l){return "mousedown".split(" ")};${'x'.repeat(220)}`), 'Interface failed'))

    expect(screen.getByText('Interface failed. Technical details are available in Diagnostics.')).toBeTruthy()
    expect(screen.queryByText(/mousedown/)).toBeNull()
  })
})
