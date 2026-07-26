import { loadAppSetting, saveAppSetting } from './workspace-db.js'
import { createHash } from 'node:crypto'

const key = (versionId: string) => `human-review-notified-${createHash('sha256').update(versionId).digest('hex').slice(0, 32)}`

export function reserveHumanReviewNotification(userData: string, versionId: string | undefined, remind = false): { allowed: boolean; deduplicated: boolean } {
  if (!versionId || remind) return { allowed: true, deduplicated: false }
  if (loadAppSetting(userData, key(versionId)) === 'shown') return { allowed: false, deduplicated: true }
  saveAppSetting(userData, key(versionId), 'shown')
  return { allowed: true, deduplicated: false }
}
