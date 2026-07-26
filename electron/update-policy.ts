import { sep } from 'node:path'

export type AppUpdateChannel = 'stable' | 'main'
export type AppUpdatePhase = 'unavailable' | 'blocked' | 'ready' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateStatus {
  currentVersion: string
  availableVersion?: string
  channel: AppUpdateChannel
  phase: AppUpdatePhase
  progress?: number
  currentSignatureVerified: boolean
  downloadedSignatureEnforced: boolean
  canCheck: boolean
  canDownload: boolean
  canInstall: boolean
  message: string
  error?: string
}

export function parseUpdateChannel(value: unknown): AppUpdateChannel {
  return value === 'main' ? 'main' : 'stable'
}

export function updaterFeedChannel(channel: AppUpdateChannel) {
  return channel === 'main' ? 'main' : 'latest'
}

export function macApplicationBundle(execPath: string): string | undefined {
  const normalized = execPath.split(sep).join('/')
  const match = normalized.match(/^(.*?\.app)\/Contents\/MacOS\/.+$/)
  return match?.[1]
}

export function isDeveloperIdApplicationSignature(details: string) {
  return /(?:^|\n)Authority=Developer ID Application:/m.test(details) && /(?:^|\n)TeamIdentifier=[A-Z0-9]{10}(?:\n|$)/m.test(details)
}

export function withUpdateCapabilities(status: Omit<AppUpdateStatus, 'canCheck' | 'canDownload' | 'canInstall'>): AppUpdateStatus {
  const trusted = status.currentSignatureVerified && status.downloadedSignatureEnforced
  return {
    ...status,
    canCheck: trusted && ['ready', 'error'].includes(status.phase),
    canDownload: trusted && status.phase === 'available',
    canInstall: trusted && status.phase === 'downloaded',
  }
}
