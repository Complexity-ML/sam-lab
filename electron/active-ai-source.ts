import type { ApiProvider } from './ai-provider.js'

export type ActiveAiSource = 'chatgpt' | ApiProvider
const sources = new Set<ActiveAiSource>(['chatgpt', 'openai', 'anthropic', 'moonshot'])

export function parseActiveAiSource(value: unknown): ActiveAiSource | undefined {
  return sources.has(value as ActiveAiSource) ? value as ActiveAiSource : undefined
}

export function requireSelectableAiSource(value: unknown, connected: Record<ActiveAiSource, boolean>): ActiveAiSource {
  const source = parseActiveAiSource(value)
  if (!source) throw new Error('Choose a supported SAM LAB agent source')
  if (!connected[source]) throw new Error(`Connect ${source === 'chatgpt' ? 'the ChatGPT account' : source} before selecting it as the active agent source`)
  return source
}
