import { describe, expect, it } from 'vitest'
import { isDeveloperIdApplicationSignature, macApplicationBundle, parseUpdateChannel, updaterFeedChannel, withUpdateCapabilities } from './update-policy.js'

describe('fail-closed macOS update policy', () => {
  it('keeps stable as the default and maps opt-in main builds to a separate feed', () => {
    expect(parseUpdateChannel(undefined)).toBe('stable')
    expect(parseUpdateChannel('unknown')).toBe('stable')
    expect(updaterFeedChannel('stable')).toBe('latest')
    expect(updaterFeedChannel('main')).toBe('main')
  })

  it('finds a packaged .app bundle without accepting a development executable', () => {
    expect(macApplicationBundle('/Applications/SAM LAB.app/Contents/MacOS/SAM LAB')).toBe('/Applications/SAM LAB.app')
    expect(macApplicationBundle('/private/tmp/Electron')).toBeUndefined()
  })

  it('accepts a Developer ID Application identity with a team identifier, not ad-hoc signing', () => {
    expect(isDeveloperIdApplicationSignature('Authority=Developer ID Application: SAM LAB (ABCDE12345)\nTeamIdentifier=ABCDE12345\n')).toBe(true)
    expect(isDeveloperIdApplicationSignature('Signature=adhoc\nTeamIdentifier=not set\n')).toBe(false)
  })

  it('never enables installation until a signed current app has a downloaded update', () => {
    const base = { currentVersion: '0.1.0', channel: 'stable' as const, currentSignatureVerified: true, downloadedSignatureEnforced: true, message: 'test' }
    expect(withUpdateCapabilities({ ...base, phase: 'available' }).canInstall).toBe(false)
    expect(withUpdateCapabilities({ ...base, phase: 'downloaded' }).canInstall).toBe(true)
    expect(withUpdateCapabilities({ ...base, phase: 'downloaded', currentSignatureVerified: false }).canInstall).toBe(false)
  })
})
