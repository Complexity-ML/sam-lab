import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage, toastEventName, type ToastEventDetail } from '../../domain/toasts'

interface ToastItem extends ToastEventDetail { id: number }

export function ToastViewport() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    let nextId = 0
    const push = (detail: ToastEventDetail) => {
      const id = ++nextId
      setToasts((current) => current.some((toast) => toast.message === detail.message) ? current : [...current.slice(-3), { ...detail, id }])
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6500)
    }
    const onToast = (event: Event) => push((event as CustomEvent<ToastEventDetail>).detail)
    const onError = (event: ErrorEvent) => push({ message: errorMessage(event.error ?? event.message), title: 'Interface error', tone: 'error' })
    const onUnhandledRejection = (event: PromiseRejectionEvent) => push({ message: errorMessage(event.reason, 'A background operation failed'), title: 'Background error', tone: 'error' })
    window.addEventListener(toastEventName, onToast)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener(toastEventName, onToast)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  const icon = (tone: ToastEventDetail['tone']) => tone === 'error' ? <AlertCircle size={18} /> : tone === 'warning' ? <AlertTriangle size={18} /> : tone === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />

  return <aside aria-label="Notifications" aria-live="polite" className="toast-viewport">
    {toasts.map((toast) => <article className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span>{icon(toast.tone)}</span>
      <div><strong>{toast.title}</strong><p>{toast.message}</p></div>
      <button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((candidate) => candidate.id !== toast.id))} type="button"><X size={15} /></button>
    </article>)}
  </aside>
}
