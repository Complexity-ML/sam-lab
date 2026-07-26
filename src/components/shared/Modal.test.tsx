// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(cleanup)

describe('Modal accessibility', () => {
  it('traps keyboard focus and restores the opener after close', async () => {
    const close = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<Modal ariaLabelledby="title" onClose={close}><h2 id="title">Dialog</h2><button>First</button><button>Last</button></Modal>)
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))

    screen.getByRole('button', { name: 'Last' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalled()

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
