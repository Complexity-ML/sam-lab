export class BoundedTaskPool {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Task pool limit must be a positive integer')
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active += 1
    else await new Promise<void>((resolve) => this.waiting.push(resolve))
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}

export function dataHubMcpReadLimit(mode: 'http' | 'stdio') {
  return mode === 'stdio' ? 8 : 12
}
