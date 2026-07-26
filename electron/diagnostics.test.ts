import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportDiagnosticBundle, loadDiagnosticSettings, recordDiagnosticEvent, sanitizeDiagnosticValue, saveDiagnosticSettings } from './diagnostics.js'

let directory: string | undefined
afterEach(() => { if (directory) rmSync(directory, { force: true, recursive: true }); directory = undefined })

describe('privacy-safe diagnostics', () => {
  it('redacts credentials, authorization headers and sensitive prompts recursively', () => {
    const sanitized = sanitizeDiagnosticValue({ authorization: 'Bearer abc.def', apiKey: 'sk_secretvalue', nested: { url: 'https://example.test?token=private', prompt: 'private catalog prompt', sensitive: true } }) as Record<string, unknown>
    expect(sanitized.authorization).toBe('[REDACTED]')
    expect(sanitized.apiKey).toBe('[REDACTED]')
    expect((sanitized.nested as Record<string, unknown>).url).toContain('[REDACTED]')
    expect((sanitized.nested as Record<string, unknown>).prompt).toBe('[REDACTED]')
  })

  it('bounds retention and exports a local-only sanitized bundle', () => {
    directory = mkdtempSync(join(tmpdir(), 'sam-lab-diagnostics-'))
    for (let index = 0; index < 520; index += 1) recordDiagnosticEvent(directory, { category: 'mcp', action: 'context.read', status: 'success', detail: { index, token: `secret-${index}` } })
    const bundle = exportDiagnosticBundle(directory)
    expect(bundle.events).toHaveLength(500)
    expect(bundle.telemetryEnabled).toBe(false)
    expect(bundle.settings).toEqual({ enabled: true, level: 'all', retentionDays: 7, maximumEvents: 500 })
    expect((bundle.events[0].detail as Record<string, unknown>).token).toBe('[REDACTED]')
  })

  it('applies saved detail and retention settings to real local logging', () => {
    directory = mkdtempSync(join(tmpdir(), 'sam-lab-diagnostics-settings-'))
    expect(loadDiagnosticSettings(directory)).toEqual({ enabled: true, level: 'all', retentionDays: 7, maximumEvents: 500 })
    saveDiagnosticSettings(directory, { enabled: true, level: 'warnings', retentionDays: 14, maximumEvents: 100 })
    recordDiagnosticEvent(directory, { category: 'workspace', action: 'draft.saved', status: 'success' })
    recordDiagnosticEvent(directory, { category: 'mcp', action: 'connection.failed', status: 'error' })
    const bundle = exportDiagnosticBundle(directory)
    expect(bundle.settings).toEqual({ enabled: true, level: 'warnings', retentionDays: 14, maximumEvents: 100 })
    expect(bundle.events.map((event) => event.action)).toEqual(['connection.failed'])
  })

  it('purges and withholds historical context while diagnostics are disabled', () => {
    directory = mkdtempSync(join(tmpdir(), 'sam-lab-diagnostics-disabled-'))
    recordDiagnosticEvent(directory, { category: 'provider', action: 'provider.failed', status: 'error' })
    expect(exportDiagnosticBundle(directory).events).toHaveLength(1)
    saveDiagnosticSettings(directory, { enabled: false, level: 'all', retentionDays: 7, maximumEvents: 500 })
    expect(exportDiagnosticBundle(directory)).toMatchObject({ settings: { enabled: false }, events: [] })
    saveDiagnosticSettings(directory, { enabled: true, level: 'all', retentionDays: 7, maximumEvents: 500 })
    expect(exportDiagnosticBundle(directory).events).toEqual([])
  })
})
