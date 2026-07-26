export type AppUpdateChannel = 'stable' | 'main'

export type AppUpdatePhase =
  | 'unavailable'
  | 'blocked'
  | 'ready'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

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

export const unavailableAppUpdateStatus: AppUpdateStatus = {
  currentVersion: 'web preview',
  channel: 'stable',
  phase: 'unavailable',
  currentSignatureVerified: false,
  downloadedSignatureEnforced: false,
  canCheck: false,
  canDownload: false,
  canInstall: false,
  message: 'Updates are available only in a signed SAM LAB desktop application.',
}
