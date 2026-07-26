import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronState = vi.hoisted(() => ({ directory: '', encryptionAvailable: true, availabilityChecks: 0, decryptions: 0 }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.directory },
  safeStorage: {
    decryptString: (buffer: Buffer) => { electronState.decryptions += 1; return buffer.toString('utf8').replace(/^encrypted:/, '') },
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    isEncryptionAvailable: () => { electronState.availabilityChecks += 1; return electronState.encryptionAvailable },
  },
}))

import { getAiStatus, modelCapabilities, redactSensitive, refreshAiModelCatalog, runAiProposal, saveAiSettings } from './ai-provider.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sam-lab-ai-provider-'))
  electronState.directory = directory
  electronState.encryptionAvailable = true
  electronState.availabilityChecks = 0
  electronState.decryptions = 0
  process.env.OPENAI_API_KEY = ''
  process.env.ANTHROPIC_API_KEY = ''
  process.env.MOONSHOT_API_KEY = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(directory, { force: true, recursive: true })
})

describe('secure provider credential lifecycle', () => {
  it('reports startup status without probing or opening operating-system secure storage', async () => {
    const status = await getAiStatus()
    expect(status.providers.openai.credentialSource).toBe('none')
    expect(electronState.availabilityChecks).toBe(0)
    expect(electronState.decryptions).toBe(0)
  })

  it('saves, rotates and removes each provider key independently without exposing it to the renderer status', async () => {
    await saveAiSettings({ provider: 'openai', apiKey: 'sk-first-secret' })
    await saveAiSettings({ provider: 'anthropic', apiKey: 'key-anthropic-secret' })
    await saveAiSettings({ provider: 'openai', apiKey: 'sk-rotated-secret' })

    electronState.availabilityChecks = 0
    const status = await getAiStatus()
    expect(status.providers.openai).toMatchObject({ connected: true, credentialSource: 'encrypted' })
    expect(status.providers.anthropic).toMatchObject({ connected: true, credentialSource: 'encrypted' })
    expect(JSON.stringify(status)).not.toContain('secret')
    expect(electronState.availabilityChecks).toBe(0)
    expect(electronState.decryptions).toBe(0)

    const stored = readFileSync(join(directory, 'ai-provider.json'), 'utf8')
    expect(stored).not.toContain('sk-rotated-secret')
    expect(stored).not.toContain('key-anthropic-secret')

    await saveAiSettings({ provider: 'openai', clearKey: true })
    const cleared = await getAiStatus()
    expect(cleared.providers.openai.connected).toBe(false)
    expect(cleared.providers.anthropic.connected).toBe(true)
  })

  it('refuses to write a plaintext fallback when secure storage is unavailable', async () => {
    electronState.encryptionAvailable = false
    await expect(saveAiSettings({ provider: 'moonshot', apiKey: 'key-moonshot-secret' })).rejects.toThrow('Secure credential storage is unavailable')
    expect(() => readFileSync(join(directory, 'ai-provider.json'), 'utf8')).toThrow()
  })

  it('redacts authorization headers and common provider token formats from errors and logs', () => {
    const source = 'Authorization: "Bearer sk-example-secret123" api_key="key-private-secret123" access_token="token-private-secret123"'
    const redacted = redactSensitive(source)
    expect(redacted).not.toContain('secret123')
    expect(redacted).toContain('[REDACTED]')
  })
})

describe('provider model capabilities', () => {
  it('enables only controls supported by the selected provider and model', () => {
    expect(modelCapabilities('openai', 'gpt-5.6-terra')).toMatchObject({ reasoning: true, verbosity: true, serviceTier: true })
    expect(modelCapabilities('anthropic', 'claude-opus-4-8')).toMatchObject({ reasoning: false, verbosity: false, serviceTier: false })
    expect(modelCapabilities('moonshot', 'kimi-k3')).toMatchObject({ reasoning: true, verbosity: false, serviceTier: false })
  })

  it('marks known legacy model families as deprecated', () => {
    expect(modelCapabilities('openai', 'gpt-3.5-turbo').deprecated).toBe(true)
    expect(modelCapabilities('anthropic', 'claude-2.1').deprecated).toBe(true)
  })

  it('caches a refreshed catalog while preserving a manual model ID that is temporarily unavailable', async () => {
    await saveAiSettings({ provider: 'openai', model: 'my-fine-tuned-model', apiKey: 'sk-catalog-secret' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-fast' }] }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const status = await refreshAiModelCatalog({ provider: 'openai' })

    expect(status.providers.openai.catalog.map((model) => model.id)).toEqual(['gpt-5.6-terra', 'gpt-5.6-fast'])
    expect(status.providers.openai.catalogRefreshedAt).toBeTruthy()
    expect(status.providers.openai.modelUnavailable).toBe(true)
    expect(status.settings.model).toBe('my-fine-tuned-model')
  })
})

describe('OpenAI agent tool loop', () => {
  it('preserves reasoning output, returns tool results, and finishes with a host-validated proposal', async () => {
    await saveAiSettings({ provider: 'openai', model: 'gpt-5.6-terra', apiKey: 'sk-tool-secret' })
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(request)
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          model: 'gpt-5.6-terra',
          output: [
            { type: 'reasoning', id: 'reasoning-1', summary: [] },
            { type: 'function_call', call_id: 'call-card-kinds', name: 'list_card_kinds', arguments: '{}' },
            { type: 'function_call', call_id: 'call-inspect', name: 'inspect_graph', arguments: '{"node_ids":[]}' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        model: 'gpt-5.6-terra',
        usage: { input_tokens: 100, output_tokens: 20 },
        output: [
          { type: 'function_call', call_id: 'call-add', name: 'add_card', arguments: JSON.stringify({
            node_id: 'profile-1',
            kind: 'profile',
            label: 'Customer profile',
            description: null,
            owner: null,
            rule: 'schema=versioned',
            reason: 'Keep compact evidence.',
          }) },
          { type: 'function_call', call_id: 'call-validate', name: 'validate_plan', arguments: '{}' },
          { type: 'function_call', call_id: 'call-finish', name: 'finish_plan', arguments: JSON.stringify({
            title: 'Add profile memory',
            summary: 'Store a compact reusable metadata profile.',
            rationale: 'Avoid repeated schema reconstruction.',
            requires_human_review: false,
            confidence: 0.92,
            writeback: 'Commit locally after review.',
            evidence: ['list_schema_fields · ok'],
          }) },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await runAiProposal({
      graph: {
        nodes: [{ id: 'source-1', kind: 'source' }],
        edges: [],
      },
    })

    expect(result.proposal.actions[0]).toMatchObject({
      type: 'add_card',
      node_id: 'profile-1',
      description: 'Agent-proposed Data Profile awaiting graph review.',
    })
    expect(result.toolTrace?.map((item) => item.tool)).toEqual(['list_card_kinds', 'inspect_graph', 'add_card', 'validate_plan', 'finish_plan'])
    expect(requests[0]).toMatchObject({ tool_choice: 'required', parallel_tool_calls: true, store: false })
    expect(Array.isArray(requests[0].tools)).toBe(true)
    const secondInput = requests[1].input as Record<string, unknown>[]
    expect(secondInput).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning', id: 'reasoning-1' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call-card-kinds' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call-inspect' }),
    ]))
  })
})
