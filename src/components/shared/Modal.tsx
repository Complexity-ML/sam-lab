import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  ariaLabelledby: string
  children: ReactNode
  className?: string
  onClose: () => void
}

export function Modal({ ariaLabelledby, children, className = '', onClose }: ModalProps) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    const focusFirstControl = () => shellRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus()
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab' || !shellRef.current) return
      const controls = Array.from(shellRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter((control) => !control.closest('[inert]'))
      if (controls.length === 0) { event.preventDefault(); shellRef.current.focus(); return }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.body.classList.add('has-modal')
    window.addEventListener('keydown', handleKeyboard)
    window.requestAnimationFrame(focusFirstControl)
    return () => {
      document.body.classList.remove('has-modal')
      window.removeEventListener('keydown', handleKeyboard)
      previousFocus?.focus()
    }
  }, [])

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) closeRef.current()
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={closeFromBackdrop}>
    <section aria-labelledby={ariaLabelledby} aria-modal="true" className={`modal-shell ${className}`.trim()} ref={shellRef} role="dialog" tabIndex={-1}>{children}</section>
  </div>, document.body)
}
