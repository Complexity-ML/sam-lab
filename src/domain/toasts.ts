export const toastEventName = 'sam-lab:toast'

export type ToastTone = 'error' | 'info' | 'success' | 'warning'

export interface ToastEventDetail {
  message: string
  title: string
  tone: ToastTone
}

export function errorMessage(error: unknown, fallback = 'An unexpected error occurred') {
  const raw = error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : ''
  if (!raw) return fallback
  const firstLine = raw.split(/\r?\n/, 1)[0]!.trim()
  const looksLikeMinifiedCode = firstLine.length > 180 && /(?:\bvar\s+[A-Za-z_$]|\bfunction\b|=>|\.split\(["']|[)}];var\s)/.test(firstLine)
  return looksLikeMinifiedCode ? `${fallback}. Technical details are available in Diagnostics.` : firstLine.slice(0, 320)
}

export function notifyToast(message: string, tone: ToastTone = 'info', title?: string) {
  if (typeof window === 'undefined') return
  const normalized = message.trim().slice(0, 480)
  if (!normalized) return
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(toastEventName, { detail: { message: normalized, tone, title: title ?? (tone === 'error' ? 'Something went wrong' : tone === 'warning' ? 'Attention needed' : tone === 'success' ? 'Completed' : 'SAM LAB') } }))
}

export function notifyError(error: unknown, fallback?: string) {
  notifyToast(errorMessage(error, fallback), 'error')
}
