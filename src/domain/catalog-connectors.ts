import type { SchemaField } from './pipeline'

export type CatalogConnectorKind = 'mcp' | 'http-api'

export type DataValueRiskKind =
  | 'empty_dataset'
  | 'volume_drop'
  | 'volume_spike'
  | 'null_spike'
  | 'fully_null'
  | 'duplicate_drift'
  | 'distribution_shift'

export interface DataValueRiskSignal {
  id: string
  kind: DataValueRiskKind
  severity: 'critical' | 'high' | 'medium' | 'low'
  field?: string
  summary: string
  current?: number
  previous?: number
}

export interface DataFieldProfileSummary {
  name: string
  nullRate?: number
  previousNullRate?: number
  distinctCount?: number
  uniqueProportion?: number
  previousUniqueProportion?: number
  mean?: number
  previousMean?: number
  stdev?: number
  previousStdev?: number
}

export interface DataValueProfileSummary {
  status: 'available' | 'unavailable' | 'error'
  capturedAt?: string
  previousCapturedAt?: string
  rowCount?: number
  previousRowCount?: number
  fields: DataFieldProfileSummary[]
  risks: DataValueRiskSignal[]
}

export type LineageAssetKind = 'dataset' | 'feature' | 'model' | 'deployment' | 'pipeline' | 'unknown'

export interface LineageAssetSummary {
  urn: string
  name: string
  sensitive: boolean
  kind?: LineageAssetKind
}

export interface CatalogConnectorManifest {
  id: string
  name: string
  kind: CatalogConnectorKind
  url: string
  enabled: boolean
  contract: 'sam-lab.catalog.v1'
  searchTool?: string
  inspectTool?: string
}

export interface CatalogConnectorSummary extends CatalogConnectorManifest {
  builtIn: boolean
  tokenConfigured: boolean
}

export interface CatalogAssetSummary {
  connectorId: string
  sourceSystem: string
  assetRef: string
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
  dataProfile?: DataValueProfileSummary
  upstream: LineageAssetSummary[]
  downstream: LineageAssetSummary[]
  freshness: { capturedAt: string; expiresAt: string; stale: boolean }
}

export interface CatalogEvidence {
  connectorId: string
  sourceSystem: string
  tool: string
  assetRef: string
  urn: string
  capturedAt: string
  expiresAt: string
  status: 'ok' | 'unavailable' | 'error'
  summary: string
  cached: boolean
  stale: boolean
}

export interface CatalogInspection {
  asset: CatalogAssetSummary
  evidence: CatalogEvidence[]
}

export const catalogConnectorDefaults = {
  contract: 'sam-lab.catalog.v1' as const,
  searchTool: 'catalog_search',
  inspectTool: 'catalog_inspect',
}
