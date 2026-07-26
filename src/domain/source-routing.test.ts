import { describe, expect, it } from 'vitest'
import type { PipelineNode } from './pipeline'
import { asksForSeparateWorkspace, selectDataSources, workspaceNameFromObjective } from './source-routing'

const sources = [
  { id: 'snowflake-customers', type: 'pipeline', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Customers 360', description: '', owner: '', status: 'healthy', schema: [], datahubUrn: 'urn:li:dataset:(snowflake,customers,PROD)', datahubPlatform: 'snowflake' } },
  { id: 'powerbi-orders', type: 'pipeline', position: { x: 0, y: 100 }, data: { kind: 'source', label: 'Order Measures', description: '', owner: '', status: 'healthy', schema: [], datahubUrn: 'urn:li:dataset:(powerbi,orders,PROD)', datahubPlatform: 'powerbi' } },
  { id: 'kafka-events', type: 'pipeline', position: { x: 0, y: 200 }, data: { kind: 'source', label: 'Checkout Events', description: '', owner: '', status: 'healthy', schema: [], datahubUrn: 'urn:li:dataset:(kafka,checkout,PROD)', datahubPlatform: 'kafka' } },
] as PipelineNode[]

describe('prompt source routing', () => {
  it('selects one explicitly named source instead of the first graph source', () => {
    expect(selectDataSources(sources, 'Analyse les Order Measures dans PowerBI')).toMatchObject({
      mode: 'single',
      sources: [{ id: 'powerbi-orders' }],
    })
  })

  it('selects multiple mentioned sources and bounds an ambiguous comparison', () => {
    expect(selectDataSources(sources, 'Compare Customers 360 et Checkout Events')).toMatchObject({
      mode: 'explicit-multiple',
      sources: [{ id: 'snowflake-customers' }, { id: 'kafka-events' }],
    })
    expect(selectDataSources(sources, 'Compare toutes les sources', 2)).toMatchObject({
      mode: 'all-candidates',
      sources: [{ id: 'snowflake-customers' }, { id: 'powerbi-orders' }],
    })
  })

  it('requires explicit separate-workspace language', () => {
    expect(asksForSeparateWorkspace('Ajoute une nouvelle source à ce graphe')).toBe(false)
    expect(asksForSeparateWorkspace('Crée un nouveau workspace pour les commandes')).toBe(true)
    expect(asksForSeparateWorkspace('Use a separate graph for billing')).toBe(true)
    expect(workspaceNameFromObjective('Crée un nouveau workspace pour les commandes')).toContain('commandes')
  })
})
