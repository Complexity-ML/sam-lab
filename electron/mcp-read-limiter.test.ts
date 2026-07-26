import { describe, expect, it } from 'vitest'
import { BoundedTaskPool, dataHubMcpReadLimit } from './mcp-read-limiter.js'

describe('MCP read backpressure', () => {
  it('bounds concurrent transport calls while preserving every result', async () => {
    const pool = new BoundedTaskPool(3)
    let active = 0
    let maximumActive = 0
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => pool.run(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return index
    })))

    expect(maximumActive).toBe(3)
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index))
  })

  it('keeps stdio below the burst produced by six dataset workers', () => {
    expect(dataHubMcpReadLimit('stdio')).toBe(8)
    expect(dataHubMcpReadLimit('http')).toBe(12)
  })
})
