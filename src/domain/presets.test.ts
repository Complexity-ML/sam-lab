import { describe, expect, it } from 'vitest'
import { validatePipeline } from '../validation'
import { loadPipelinePreset, type PipelinePresetId } from './pipeline'

const scenarios: Array<{ id: PipelinePresetId; expectedFinding: string }> = [
  { id: 'pii-masking', expectedFinding: 'sensitive-unprotected-pii-source-pii-output' },
  { id: 'schema-drift', expectedFinding: 'schema-contract-type-drift-contract-customer_age' },
  { id: 'broken-governance', expectedFinding: 'missing-owner-governance-source' },
]

const samScenarios: PipelinePresetId[] = ['license-reclamation', 'compliance-exposure', 'renewal-optimization']

describe('optional judge-readable presets', () => {
  it.each(scenarios)('loads $id only when explicitly selected and exposes its expected validation', ({ id, expectedFinding }) => {
    const preset = loadPipelinePreset(id)
    expect(preset.nodes.length).toBeGreaterThan(0)
    expect(validatePipeline(preset.nodes, preset.edges).map((finding) => finding.id)).toContain(expectedFinding)
    expect(JSON.stringify(preset)).not.toMatch(/(?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]/i)
  })

  it('keeps blank startup independent from all optional examples', () => {
    expect(loadPipelinePreset('empty')).toEqual({ title: 'Untitled pipeline', nodes: [], edges: [] })
  })

  it.each(samScenarios)('loads the %s SAM workflow as a complete connected decision path', (id) => {
    const preset = loadPipelinePreset(id)
    expect(preset.nodes[0]?.data.kind).toBe('source')
    expect(preset.nodes.at(-1)?.data.kind).toBe('output')
    expect(preset.edges).toHaveLength(preset.nodes.length - 1)
    expect(preset.nodes.some((node) => node.data.kind === 'review')).toBe(true)
  })

  it('binds the Copilot optimization example to a profiled DataHub asset with downstream decisions', () => {
    const preset = loadPipelinePreset('license-reclamation')
    const source = preset.nodes[0]
    expect(source?.data.datahubUrn).toBe('urn:li:dataset:(urn:li:dataPlatform:postgres,sam-copilot-demo.sam_copilot.sam_mart.license_utilization,PROD)')
    expect(source?.data.datahubTags).toEqual(expect.arrayContaining(['SAM', 'PSEUDONYMIZED', 'LICENSE_USAGE']))
    expect(source?.data.datahubDownstream?.map((asset) => asset.name)).toEqual(['reclaim_candidates', 'renewal_risk'])
    expect(preset.nodes.find((node) => node.data.kind === 'impact')?.data.description).toContain('USD 9,348')
  })

  it('shows the judge-readable ML chain from impact evidence to an explicit risk context', () => {
    const preset = loadPipelinePreset('schema-drift')
    const risk = preset.nodes.find((node) => node.data.kind === 'risk')
    expect(risk?.data.rule).toContain('risk_type=data')
    expect(preset.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'impact-lineage', target: risk?.id }),
      expect.objectContaining({ source: risk?.id, target: 'drift-contract' }),
    ]))
  })

  it('returns isolated graphs so editing one loaded example cannot mutate the catalog', () => {
    const first = loadPipelinePreset('schema-drift')
    first.nodes[0].data.label = 'Changed locally'
    expect(loadPipelinePreset('schema-drift').nodes[0].data.label).toBe('Training customers v2')
  })
})
