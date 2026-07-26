import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reserveHumanReviewNotification } from './human-review-notifications.js'
import { closeWorkspaceDatabase } from './workspace-db.js'

let directory = ''
afterEach(() => { closeWorkspaceDatabase(); if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('native Human Review notification deduplication', () => {
  it('notifies once per revision and allows an explicit reminder', () => {
    directory = mkdtempSync(join(tmpdir(), 'sam-lab-review-'))
    expect(reserveHumanReviewNotification(directory, 'version-1')).toEqual({ allowed: true, deduplicated: false })
    expect(reserveHumanReviewNotification(directory, 'version-1')).toEqual({ allowed: false, deduplicated: true })
    expect(reserveHumanReviewNotification(directory, 'version-1', true)).toEqual({ allowed: true, deduplicated: false })
  })
})
