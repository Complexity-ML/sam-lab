import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('application architecture', () => {
  it('keeps App as a bounded composition root', () => {
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(source.split('\n').length - 1).toBeLessThanOrEqual(500)
    expect(source).toContain('useAutonomousPlayer')
    expect(source).not.toContain('const auditWithAgent')
  })
})
