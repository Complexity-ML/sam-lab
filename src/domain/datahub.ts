import type { SchemaField } from './pipeline'
import type { CatalogAssetSummary, CatalogEvidence, LineageAssetSummary } from './catalog-connectors'

export interface DataHubEvidence extends Omit<CatalogEvidence, 'connectorId' | 'sourceSystem' | 'assetRef'> {
  connectorId?: string
  sourceSystem?: string
  assetRef?: string
  tool: string
  urn: string
  capturedAt: string
  expiresAt: string
  status: 'ok' | 'unavailable' | 'error'
  summary: string
  cached: boolean
  stale: boolean
}

export interface DataHubAssetSummary extends Omit<CatalogAssetSummary, 'connectorId' | 'sourceSystem' | 'assetRef'> {
  connectorId?: string
  sourceSystem?: string
  assetRef?: string
  urn: string
  name: string
  platform: string
  environment: string
  description: string
  owners: string[]
  domain?: string
  tags: string[]
  fields: SchemaField[]
  qualityStatus: 'healthy' | 'failing' | 'unavailable'
  upstream: LineageAssetSummary[]
  downstream: LineageAssetSummary[]
  freshness: { capturedAt: string; expiresAt: string; stale: boolean }
}
