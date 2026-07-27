import { useEffect, useState } from 'react'
import { notifyError } from '../domain/toasts'
import { recordDiagnostic } from '../domain/diagnostics'
import type { CatalogConnectorManifest, CatalogConnectorSummary } from '../domain/catalog-connectors'

type ConnectionMode = 'demo' | 'connected'
type McpTransport = 'demo' | 'http' | 'stdio'
export type DataHubConnectionSettings = {
  transport: 'http' | 'stdio'
  url: string
  catalogReadRoute?: 'auto' | 'gms' | 'mcp'
  tokenConfigured: boolean
  tokenSource: 'encrypted' | 'environment' | 'none'
  encryptionAvailable: boolean
  writebackEnabled: boolean
}

const disconnectedSettings: DataHubConnectionSettings = { transport: 'stdio', url: '', tokenConfigured: false, tokenSource: 'none', encryptionAvailable: false, writebackEnabled: false }

export function useDataHubConnection(setActivity: (message: string) => void) {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('demo')
  const [mcpTransport, setMcpTransport] = useState<McpTransport>('demo')
  const [mcpMessage, setMcpMessage] = useState('Local demo context')
  const [writebackAvailable, setWritebackAvailable] = useState(false)
  const [settings, setSettings] = useState<DataHubConnectionSettings>(disconnectedSettings)
  const [catalogConnectors, setCatalogConnectors] = useState<CatalogConnectorSummary[]>([])
  const [verifiedConnectorIds, setVerifiedConnectorIds] = useState<Set<string>>(new Set())

  const applyStatus = (status: Awaited<ReturnType<NonNullable<typeof window.dataLab>['getDataHubMcpStatus']>>) => {
    setConnectionMode(status.mode)
    setMcpTransport(status.transport)
    setMcpMessage(status.message)
    setWritebackAvailable(status.writebackAvailable)
    setSettings(status.settings)
  }

  useEffect(() => {
    if (!window.dataLab) return
    void window.dataLab.getDataHubMcpStatus().then(applyStatus).catch(() => undefined)
    if (window.dataLab.listCatalogConnectors) void window.dataLab.listCatalogConnectors().then(setCatalogConnectors).catch(() => undefined)
  }, [])

  const recordAudit = (transport: Exclude<McpTransport, 'demo'>, completedReads: number, totalReads: number) => {
    setConnectionMode('connected')
    setMcpTransport(transport)
    setMcpMessage(`MCP ${transport} · ${completedReads}/${totalReads} reads completed`)
  }

  const syncDataHub = async () => {
    if (!window.dataLab) {
      setActivity('Web demo mode · launch Electron with DATAHUB_GMS_URL to connect DataHub')
      return
    }
    try {
      const status = await window.dataLab.connectDataHubMcp()
      applyStatus(status)
      recordDiagnostic({ category: 'mcp', action: 'connection.sync', status: status.mode === 'connected' ? 'success' : 'warning', detail: { transport: status.transport, message: status.message, toolCount: status.toolCount } })
      setActivity(status.mode === 'connected' ? `${status.message} · ready for agent audits` : status.message)
      return status
    } catch (error) {
      notifyError(error, 'DataHub MCP connection failed')
      recordDiagnostic({ category: 'mcp', action: 'connection.sync', status: 'error', detail: { message: error instanceof Error ? error.message : 'unknown error' } })
      setConnectionMode('demo')
      setWritebackAvailable(false)
      setMcpMessage(error instanceof Error ? error.message : 'unknown error')
      setActivity(`DataHub MCP connection failed · ${error instanceof Error ? error.message : 'unknown error'}`)
      return undefined
    }
  }

  const saveSettings = async (payload: { transport: 'http' | 'stdio'; url: string; catalogReadRoute?: 'auto' | 'gms' | 'mcp'; token?: string; clearToken?: boolean; writebackEnabled?: boolean }) => {
    if (!window.dataLab) throw new Error('DataHub settings require the Electron application')
    const status = await window.dataLab.saveDataHubMcpSettings(payload)
    applyStatus(status)
    if (window.dataLab.listCatalogConnectors) setCatalogConnectors(await window.dataLab.listCatalogConnectors())
    return status
  }

  const searchAssets = async (query: string) => {
    if (!window.dataLab) throw new Error('Catalog search requires the Electron application')
    const assets = window.dataLab.searchCatalogAssets ? await window.dataLab.searchCatalogAssets(query) : await window.dataLab.searchDataHubAssets(query)
    setVerifiedConnectorIds((current) => new Set([...current, ...assets.map((asset) => asset.connectorId ?? 'datahub')]))
    return assets
  }

  const inspectAsset = async (assetRef: string, force = false, connectorId?: string, mode: 'summary' | 'deep' = 'deep') => {
    if (!window.dataLab) throw new Error('Catalog inspection requires the Electron application')
    const resolvedConnector = connectorId ?? 'datahub'
    const inspection = window.dataLab.inspectCatalogAsset
      ? await window.dataLab.inspectCatalogAsset(resolvedConnector, assetRef, force, mode)
      : await window.dataLab.inspectDataHubAsset(assetRef, force, mode).then((legacyInspection) => ({
        asset: { ...legacyInspection.asset, connectorId: 'datahub', sourceSystem: 'DataHub', assetRef },
        evidence: legacyInspection.evidence.map((read) => ({ ...read, connectorId: 'datahub', sourceSystem: 'DataHub', assetRef, urn: assetRef, tool: read.name })),
    }))
    setVerifiedConnectorIds((current) => new Set(current).add(resolvedConnector))
    return inspection
  }

  const saveCatalogConnector = async (payload: CatalogConnectorManifest & { token?: string; clearToken?: boolean }) => {
    if (!window.dataLab) throw new Error('Catalog connections require the Electron application')
    if (!window.dataLab.saveCatalogConnector) throw new Error('This SAM LAB build does not support custom catalog connections')
    const saved = await window.dataLab.saveCatalogConnector(payload)
    setCatalogConnectors(saved)
    return saved
  }

  const deleteCatalogConnector = async (id: string) => {
    if (!window.dataLab) throw new Error('Catalog connections require the Electron application')
    if (!window.dataLab.deleteCatalogConnector) throw new Error('This SAM LAB build does not support custom catalog connections')
    const saved = await window.dataLab.deleteCatalogConnector(id)
    setCatalogConnectors(saved)
    setVerifiedConnectorIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    return saved
  }

  const testCatalogConnector = async (id: string) => {
    if (!window.dataLab) throw new Error('Catalog connections require the Electron application')
    if (!window.dataLab.testCatalogConnector) throw new Error('This SAM LAB build does not support custom catalog connections')
    const result = await window.dataLab.testCatalogConnector(id)
    setVerifiedConnectorIds((current) => {
      const next = new Set(current)
      if (result.connected) next.add(id)
      else next.delete(id)
      return next
    })
    return result
  }

  const invalidateContext = async (urn?: string) => {
    if (!window.dataLab) return { invalidated: true as const }
    return window.dataLab.invalidateDataHubContext(urn)
  }

  const writeDecision = async (payload: { revisionId: string; title: string; rationale: string; author: string; relatedAssets: string[] }) => {
    if (!window.dataLab) throw new Error('DataHub write-back requires the Electron application')
    return window.dataLab.writeDataHubDecision(payload)
  }

  const catalogConnectionMode: ConnectionMode = connectionMode === 'connected' || verifiedConnectorIds.size > 0 ? 'connected' : 'demo'

  return { catalogConnectionMode, catalogConnectors, connectionMode, deleteCatalogConnector, inspectAsset, invalidateContext, mcpMessage, mcpTransport, recordAudit, saveCatalogConnector, saveSettings, searchAssets, settings, syncDataHub, testCatalogConnector, writebackAvailable, writeDecision }
}
