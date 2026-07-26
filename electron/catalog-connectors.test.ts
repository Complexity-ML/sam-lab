import { describe, expect, it } from 'vitest'
import { parseCatalogConnectorManifest } from './catalog-connectors.js'

describe('catalog connector manifests', () => {
  it('normalizes an MCP connector to the neutral catalog contract', () => {
    expect(parseCatalogConnectorManifest({
      id: 'snowflake-catalog',
      name: 'Snowflake Catalog',
      kind: 'mcp',
      url: 'https://catalog.example.com/mcp/',
    })).toEqual({
      id: 'snowflake-catalog',
      name: 'Snowflake Catalog',
      kind: 'mcp',
      url: 'https://catalog.example.com/mcp',
      enabled: true,
      contract: 'sam-lab.catalog.v1',
      searchTool: 'catalog_search',
      inspectTool: 'catalog_inspect',
    })
  })

  it('allows HTTP only for local development loopback services', () => {
    expect(parseCatalogConnectorManifest({
      id: 'local-catalog',
      name: 'Local Catalog',
      kind: 'http-api',
      url: 'http://127.0.0.1:4400',
    }).url).toBe('http://127.0.0.1:4400')
    expect(() => parseCatalogConnectorManifest({
      id: 'remote-catalog',
      name: 'Remote Catalog',
      kind: 'http-api',
      url: 'http://catalog.example.com',
    })).toThrow(/HTTPS/)
  })

  it('rejects embedded credentials and reserved connector IDs', () => {
    expect(() => parseCatalogConnectorManifest({
      id: 'datahub',
      name: 'Replacement',
      kind: 'mcp',
      url: 'https://catalog.example.com/mcp',
    })).toThrow(/unique identifier/)
    expect(() => parseCatalogConnectorManifest({
      id: 'private-catalog',
      name: 'Private',
      kind: 'http-api',
      url: 'https://user:secret@catalog.example.com',
    })).toThrow(/Credentials/)
  })
})
