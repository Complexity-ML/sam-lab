import { Activity, AlertTriangle, Bot, CheckCircle2, Database, Download, FileDown, FolderKanban, FolderOpen, Gauge, History, KeyRound, Languages, LayoutTemplate, LogIn, LogOut, Moon, Network, Palette, Play, RefreshCw, Save, Settings, ShieldCheck, Sun, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ActiveAiSource, AiSettings, AiStatus, ApiProvider, ChatGPTSessionStatus } from '../../domain/ai'
import type { PipelinePresetId } from '../../domain/pipeline'
import type { WorkspaceSaveState, WorkspaceSummary } from '../../domain/workspace'
import { notifyError } from '../../domain/toasts'
import { ActionButton } from './ActionButton'
import { Modal } from './Modal'
import { VersionBrowser, type VersionSummary } from './VersionBrowser'
import { WorkspaceManager } from './WorkspaceManager'
import { useLanguage } from '../../i18n'
import type { AppUpdateChannel, AppUpdateStatus } from '../../domain/updates'
import type { DiagnosticBundle, DiagnosticSettings } from '../../domain/diagnostics'
import type { AutonomyPolicy } from '../../domain/autonomy-policy'
import type { CatalogConnectorKind, CatalogConnectorManifest, CatalogConnectorSummary } from '../../domain/catalog-connectors'

export type SettingsSection = 'appearance' | 'workspaces' | 'ai' | 'autonomy' | 'connections' | 'updates' | 'diagnostics' | 'presets' | 'pipeline' | 'versions'

interface SettingsModalProps {
  activeAiSource: ActiveAiSource
  appUpdateBusy: boolean
  appUpdateStatus: AppUpdateStatus
  aiStatus: AiStatus
  autonomyPolicy: AutonomyPolicy
  chatGPTStatus: ChatGPTSessionStatus
  catalogConnectors: CatalogConnectorSummary[]
  connectionMode: 'demo' | 'connected'
  dataHubSettings: {
    transport: 'http' | 'stdio'
    url: string
    catalogReadRoute?: 'auto' | 'gms' | 'mcp'
    tokenConfigured: boolean
    tokenSource: 'encrypted' | 'environment' | 'none'
    encryptionAvailable: boolean
    writebackEnabled: boolean
  }
  errorCount: number
  findingCount: number
  incidentReportCount: number
  mcpMessage: string
  mcpTransport: 'demo' | 'http' | 'stdio'
  initialSection?: SettingsSection
  onAutoLayout: () => void
  onApprovePendingReview: (versionId: string) => void
  onArchiveWorkspace: (workspaceId: string) => Promise<void>
  onAutonomyPolicyChange: (policy: AutonomyPolicy) => void
  onCheckForAppUpdate: () => Promise<AppUpdateStatus>
  onClearIncidentReports: () => Promise<{ deleted: number; workspaceId?: string }>
  onClose: () => void
  onCancelChatGPTLogin: () => Promise<void>
  onConfigureChatGPT: (configuration: { model: string; effort: string }) => Promise<void>
  onConnectChatGPT: () => Promise<void>
  onCreateWorkspace: (name: string) => Promise<void>
  onDisconnectChatGPT: () => Promise<void>
  onEmergencyStop: () => void
  onDuplicateWorkspace: (workspaceId: string) => Promise<void>
  onDeleteWorkspace: (workspaceId: string) => Promise<void>
  onDeleteCatalogConnector: (id: string) => Promise<unknown>
  onDownloadAppUpdate: () => Promise<AppUpdateStatus>
  onExportPipeline: () => void
  onExportDiagnostics: () => Promise<void>
  onImportPipeline: (file: File) => Promise<void>
  onInstallAppUpdate: () => Promise<AppUpdateStatus>
  onLoadDiagnostics: () => Promise<DiagnosticBundle>
  onSaveDiagnosticSettings: (settings: DiagnosticSettings) => Promise<DiagnosticSettings>
  onLoadPreset: (preset: PipelinePresetId) => void
  onOpenWorkspace: (workspaceId: string) => Promise<void>
  onOpenDiagnosticLogs: () => Promise<void>
  onOpenSetupUpdater: () => Promise<{ opened: true; channel: AppUpdateChannel; path: string }>
  onRefreshAiModelCatalog: (provider: ApiProvider) => Promise<AiStatus>
  onRejectPendingReview: (versionId: string) => void
  onRemindHumanReview: (version: VersionSummary) => void
  onRenameWorkspace: (workspaceId: string, name: string) => Promise<void>
  onSaveAiSettings: (settings: Partial<AiSettings> & { apiKey?: string; clearKey?: boolean }) => Promise<AiStatus>
  onSaveCatalogConnector: (settings: CatalogConnectorManifest & { token?: string; clearToken?: boolean }) => Promise<unknown>
  onSelectActiveAiSource: (source: ActiveAiSource) => Promise<void>
  onSetAppUpdateChannel: (channel: AppUpdateChannel) => Promise<AppUpdateStatus>
  onSaveDataHubSettings: (settings: { transport: 'http' | 'stdio'; url: string; catalogReadRoute?: 'auto' | 'gms' | 'mcp'; token?: string; clearToken?: boolean; writebackEnabled?: boolean }) => Promise<unknown>
  onSyncDataHub: () => Promise<{ mode: 'demo' | 'connected'; message: string } | undefined>
  onTestCatalogConnector: (id: string) => Promise<{ connected: boolean; message: string }>
  onTestAiConnection: () => Promise<void>
  onValidate: () => void
  onThemeChange: (theme: 'light' | 'dark') => void
  onRestoreVersion: (versionId: string) => void
  onSaveVersion: () => void
  onSaveWorkspace: () => Promise<void>
  activeWorkspaceId: string | null
  projectTitle: string
  selectedVersionId?: string
  theme: 'light' | 'dark'
  versions: VersionSummary[]
  workspaceSaveState: WorkspaceSaveState
  workspaces: WorkspaceSummary[]
}

export function SettingsModal(props: SettingsModalProps) {
  const { language, setLanguage } = useLanguage()
  const { activeAiSource, activeWorkspaceId, aiStatus, appUpdateBusy, appUpdateStatus, autonomyPolicy, catalogConnectors, chatGPTStatus, connectionMode, dataHubSettings, errorCount, findingCount, incidentReportCount, initialSection, mcpMessage, mcpTransport, onApprovePendingReview, onArchiveWorkspace, onAutoLayout, onAutonomyPolicyChange, onCancelChatGPTLogin, onCheckForAppUpdate, onClearIncidentReports, onClose, onConfigureChatGPT, onConnectChatGPT, onCreateWorkspace, onDeleteCatalogConnector, onDeleteWorkspace, onDisconnectChatGPT, onDownloadAppUpdate, onDuplicateWorkspace, onEmergencyStop, onExportDiagnostics, onExportPipeline, onImportPipeline, onInstallAppUpdate, onLoadDiagnostics, onLoadPreset, onOpenDiagnosticLogs, onOpenSetupUpdater, onOpenWorkspace, onRefreshAiModelCatalog, onRejectPendingReview, onRemindHumanReview, onRenameWorkspace, onRestoreVersion, onSaveAiSettings, onSaveCatalogConnector, onSaveDataHubSettings, onSaveDiagnosticSettings, onSaveVersion, onSaveWorkspace, onSelectActiveAiSource, onSetAppUpdateChannel, onSyncDataHub, onTestAiConnection, onTestCatalogConnector, onThemeChange, onValidate, projectTitle, selectedVersionId, theme, versions, workspaceSaveState, workspaces } = props
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'appearance')
  const [aiSettings, setAiSettings] = useState(aiStatus.settings)
  const [aiBusy, setAiBusy] = useState(false)
  const [chatGPTConnecting, setChatGPTConnecting] = useState(false)
  const [chatGPTElapsed, setChatGPTElapsed] = useState(0)
  const [aiFeedback, setAiFeedback] = useState('')
  const [dataHubBusy, setDataHubBusy] = useState(false)
  const [dataHubFeedback, setDataHubFeedback] = useState('')
  const [dataHubTransport, setDataHubTransport] = useState<'http' | 'stdio'>(dataHubSettings.transport)
  const [dataHubCatalogReadRoute, setDataHubCatalogReadRoute] = useState<'auto' | 'gms' | 'mcp'>(dataHubSettings.catalogReadRoute ?? 'auto')
  const [dataHubWriteback, setDataHubWriteback] = useState(dataHubSettings.writebackEnabled)
  const [catalogKind, setCatalogKind] = useState<CatalogConnectorKind>('mcp')
  const [catalogFeedback, setCatalogFeedback] = useState('')
  const [updateFeedback, setUpdateFeedback] = useState('')
  const [diagnosticBundle, setDiagnosticBundle] = useState<DiagnosticBundle>()
  const [diagnosticSettings, setDiagnosticSettings] = useState<DiagnosticSettings>({ enabled: true, level: 'all', retentionDays: 7, maximumEvents: 500 })
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [reportsClearArmed, setReportsClearArmed] = useState(false)
  const apiKeyRef = useRef<HTMLInputElement>(null)
  const modelIdRef = useRef<HTMLInputElement>(null)
  const dataHubUrlRef = useRef<HTMLInputElement>(null)
  const dataHubTokenRef = useRef<HTMLInputElement>(null)
  const catalogIdRef = useRef<HTMLInputElement>(null)
  const catalogNameRef = useRef<HTMLInputElement>(null)
  const catalogUrlRef = useRef<HTMLInputElement>(null)
  const catalogTokenRef = useRef<HTMLInputElement>(null)
  const chatGPTConnectEpoch = useRef(0)
  const diagnosticLoaderRef = useRef(onLoadDiagnostics)

  useEffect(() => { if (initialSection) setActiveSection(initialSection) }, [initialSection])
  useEffect(() => { if (activeSection !== 'diagnostics') setReportsClearArmed(false) }, [activeSection])
  useEffect(() => { setDataHubTransport(dataHubSettings.transport) }, [dataHubSettings.transport])
  useEffect(() => { setDataHubCatalogReadRoute(dataHubSettings.catalogReadRoute ?? 'auto') }, [dataHubSettings.catalogReadRoute])
  useEffect(() => { setDataHubWriteback(dataHubSettings.writebackEnabled) }, [dataHubSettings.writebackEnabled])
  useEffect(() => { diagnosticLoaderRef.current = onLoadDiagnostics }, [onLoadDiagnostics])
  useEffect(() => {
    if (!chatGPTConnecting) { setChatGPTElapsed(0); return }
    const startedAt = Date.now()
    const timer = window.setInterval(() => setChatGPTElapsed(Math.floor((Date.now() - startedAt) / 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [chatGPTConnecting])
  useEffect(() => {
    if (activeSection !== 'diagnostics') return
    let active = true
    const refresh = async () => {
      try {
        const bundle = await diagnosticLoaderRef.current()
        if (active) {
          setDiagnosticBundle(bundle)
          setDiagnosticSettings(bundle.settings)
        }
      } catch { /* The existing diagnostics actions surface filesystem errors. */ }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [activeSection])

  const refreshDiagnostics = async () => {
    setDiagnosticsBusy(true)
    try {
      const bundle = await onLoadDiagnostics()
      setDiagnosticBundle(bundle)
      setDiagnosticSettings(bundle.settings)
    }
    catch (error) { notifyError(error, 'Unable to refresh local diagnostics') }
    finally { setDiagnosticsBusy(false) }
  }

  const saveDiagnostics = async () => {
    setDiagnosticsBusy(true)
    try {
      const saved = await onSaveDiagnosticSettings(diagnosticSettings)
      setDiagnosticSettings(saved)
      setDiagnosticBundle(await onLoadDiagnostics())
    } catch (error) { notifyError(error, 'Unable to save diagnostic settings') }
    finally { setDiagnosticsBusy(false) }
  }

  const clearReports = async () => {
    if (!reportsClearArmed) { setReportsClearArmed(true); return }
    setDiagnosticsBusy(true)
    try {
      await onClearIncidentReports()
      setReportsClearArmed(false)
    } catch (error) { notifyError(error, 'Unable to clear incident reports') }
    finally { setDiagnosticsBusy(false) }
  }

  const saveAndConnectDataHub = async () => {
    setDataHubBusy(true)
    setDataHubFeedback('')
    try {
      const token = dataHubTokenRef.current?.value.trim()
      await onSaveDataHubSettings({ transport: dataHubTransport, url: dataHubUrlRef.current?.value.trim() ?? '', catalogReadRoute: dataHubCatalogReadRoute, token: token || undefined, writebackEnabled: dataHubWriteback })
      if (dataHubTokenRef.current) dataHubTokenRef.current.value = ''
      const status = await onSyncDataHub()
      if (!status || status.mode !== 'connected') throw new Error(status?.message ?? 'DataHub MCP did not complete the connection handshake.')
      setDataHubFeedback(status.message)
    } catch (error) {
      notifyError(error, 'Unable to connect DataHub MCP')
      setDataHubFeedback(error instanceof Error ? error.message : 'Unable to connect DataHub MCP.')
    } finally { setDataHubBusy(false) }
  }

  const removeDataHubToken = async () => {
    setDataHubBusy(true)
    setDataHubFeedback('')
    try {
      await onSaveDataHubSettings({ transport: dataHubTransport, url: dataHubUrlRef.current?.value.trim() || dataHubSettings.url, catalogReadRoute: dataHubCatalogReadRoute, clearToken: true, writebackEnabled: dataHubWriteback })
      if (dataHubTokenRef.current) dataHubTokenRef.current.value = ''
      setDataHubFeedback(dataHubSettings.tokenSource === 'environment' ? 'The app token was cleared. An environment token may remain active.' : 'The encrypted DataHub token was removed.')
    } catch (error) {
      notifyError(error, 'Unable to remove the DataHub token')
      setDataHubFeedback(error instanceof Error ? error.message : 'Unable to remove the DataHub token.')
    } finally { setDataHubBusy(false) }
  }

  const saveCustomConnector = async () => {
    setDataHubBusy(true)
    setCatalogFeedback('')
    try {
      const id = catalogIdRef.current?.value.trim() ?? ''
      await onSaveCatalogConnector({
        id,
        name: catalogNameRef.current?.value.trim() ?? '',
        kind: catalogKind,
        url: catalogUrlRef.current?.value.trim() ?? '',
        enabled: true,
        contract: 'sam-lab.catalog.v1',
        ...(catalogKind === 'mcp' ? { searchTool: 'catalog_search', inspectTool: 'catalog_inspect' } : {}),
        token: catalogTokenRef.current?.value.trim() || undefined,
      })
      if (catalogTokenRef.current) catalogTokenRef.current.value = ''
      setCatalogFeedback(`Connector ${id} saved. Test it before autonomous use.`)
    } catch (error) {
      notifyError(error, 'Unable to save catalog connector')
      setCatalogFeedback(error instanceof Error ? error.message : 'Unable to save catalog connector.')
    } finally { setDataHubBusy(false) }
  }

  const testCustomConnector = async (id: string) => {
    setDataHubBusy(true)
    setCatalogFeedback('')
    try { setCatalogFeedback((await onTestCatalogConnector(id)).message) }
    catch (error) {
      notifyError(error, 'Catalog connector test failed')
      setCatalogFeedback(error instanceof Error ? error.message : 'Catalog connector test failed.')
    } finally { setDataHubBusy(false) }
  }

  const deleteCustomConnector = async (id: string) => {
    setDataHubBusy(true)
    try {
      await onDeleteCatalogConnector(id)
      setCatalogFeedback(`Connector ${id} and its saved credential were removed.`)
    } catch (error) { notifyError(error, 'Unable to delete catalog connector') }
    finally { setDataHubBusy(false) }
  }

  const draftAiSettings = (): AiSettings => ({
    ...aiSettings,
    model: modelIdRef.current?.value.trim() || aiSettings.model,
  })

  const clearSavedKey = () => {
    if (apiKeyRef.current) apiKeyRef.current.value = ''
  }

  const applySavedSettings = (status: AiStatus) => {
    setAiSettings(status.settings)
    if (modelIdRef.current) modelIdRef.current.value = status.settings.model
  }

  const saveAi = async () => {
    setAiBusy(true)
    setAiFeedback('')
    try {
      const apiKey = apiKeyRef.current?.value.trim()
      const status = await onSaveAiSettings({ ...draftAiSettings(), apiKey: apiKey || undefined })
      applySavedSettings(status)
      clearSavedKey()
      setAiFeedback('Connection settings saved securely.')
    } catch (error) {
      notifyError(error, 'Unable to save the AI connection')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to save the AI connection.')
    } finally { setAiBusy(false) }
  }

  const testAi = async () => {
    setAiBusy(true)
    setAiFeedback('')
    try {
      const draft = draftAiSettings()
      const apiKey = apiKeyRef.current?.value.trim()
      const saved = apiKey
        ? await onSaveAiSettings({ ...draft, apiKey })
        : await onSaveAiSettings(draft)
      applySavedSettings(saved)
      clearSavedKey()
      await onTestAiConnection()
      setAiFeedback(`${draft.provider === 'anthropic' ? 'Claude' : draft.provider === 'moonshot' ? 'Kimi' : 'OpenAI'} connection and model catalog verified.`)
    } catch (error) {
      notifyError(error, 'Provider connection failed')
      setAiFeedback(error instanceof Error ? error.message : 'Provider connection failed.')
    } finally { setAiBusy(false) }
  }

  const refreshModels = async () => {
    setAiBusy(true)
    setAiFeedback('Refreshing the provider model catalog…')
    try {
      const status = await onRefreshAiModelCatalog(aiSettings.provider)
      const provider = status.providers[aiSettings.provider]
      setAiFeedback(`Catalog refreshed · ${provider.catalog.length} models · ${provider.catalogRefreshedAt ? new Date(provider.catalogRefreshedAt).toLocaleString() : 'just now'}. Your manual model ID was preserved.`)
    } catch (error) {
      notifyError(error, 'Model catalog refresh failed')
      setAiFeedback(`${error instanceof Error ? error.message : 'Model catalog refresh failed'} · The current manual model ID is unchanged.`)
    } finally { setAiBusy(false) }
  }

  const removeProviderKey = async () => {
    setAiBusy(true)
    setAiFeedback('')
    try {
      const status = await onSaveAiSettings({ provider: aiSettings.provider, clearKey: true })
      applySavedSettings(status)
      clearSavedKey()
      setAiFeedback(status.providers[aiSettings.provider].credentialSource === 'environment' ? 'The saved key was removed. An environment key remains active outside SAM LAB.' : 'The provider key was removed from secure storage.')
    } catch (error) {
      notifyError(error, 'Unable to remove the provider key')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to remove the provider key.')
    } finally { setAiBusy(false) }
  }

  const connectChatGPTAccount = async () => {
    const attempt = ++chatGPTConnectEpoch.current
    setAiBusy(true)
    setChatGPTConnecting(true)
    setAiFeedback('Opening the secure ChatGPT sign-in…')
    try {
      await onConnectChatGPT()
      if (chatGPTConnectEpoch.current !== attempt) return
      setAiFeedback('ChatGPT account connected and selected for the next agent request.')
    } catch (error) {
      if (chatGPTConnectEpoch.current !== attempt) return
      notifyError(error, 'Unable to connect the ChatGPT account')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to connect the ChatGPT account.')
    } finally {
      if (chatGPTConnectEpoch.current === attempt) {
        setChatGPTConnecting(false)
        setAiBusy(false)
      }
    }
  }

  const cancelChatGPTAccountLogin = async () => {
    chatGPTConnectEpoch.current += 1
    setChatGPTConnecting(false)
    setAiBusy(false)
    setAiFeedback('Cancelling ChatGPT sign-in…')
    try {
      await onCancelChatGPTLogin()
      setAiFeedback('ChatGPT sign-in cancelled. You can retry safely.')
    } catch (error) {
      notifyError(error, 'Unable to cancel the ChatGPT sign-in')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to cancel the ChatGPT sign-in.')
    }
  }

  const disconnectChatGPTAccount = async () => {
    setAiBusy(true)
    setAiFeedback('')
    try {
      await onDisconnectChatGPT()
      setAiFeedback('ChatGPT account disconnected.')
    } catch (error) {
      notifyError(error, 'Unable to disconnect the ChatGPT account')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to disconnect the ChatGPT account.')
    } finally { setAiBusy(false) }
  }

  const chatGPTModel = chatGPTStatus.models?.find((model) => model.id === chatGPTStatus.selectedModel) ?? chatGPTStatus.models?.find((model) => model.isDefault) ?? chatGPTStatus.models?.[0]
  const chatGPTEffort = chatGPTModel?.efforts.includes(chatGPTStatus.selectedEffort ?? '') ? chatGPTStatus.selectedEffort ?? '' : chatGPTModel?.defaultEffort ?? chatGPTModel?.efforts[0] ?? ''
  const chooseProvider = (provider: ApiProvider) => setAiSettings((current) => ({ ...current, provider, model: aiStatus.providers[provider].model }))
  const activeSourceConnected = activeAiSource === 'chatgpt' ? chatGPTStatus.connected : aiStatus.providers[activeAiSource].connected
  const activeSourceModel = activeAiSource === 'chatgpt' ? chatGPTStatus.selectedModel ?? 'ChatGPT' : aiStatus.providers[activeAiSource].model
  const selectedProviderStatus = aiStatus.providers[aiSettings.provider]
  const selectedCapabilities = selectedProviderStatus.capabilities
  const runUpdateAction = async (action: () => Promise<AppUpdateStatus | { opened: true; channel: AppUpdateChannel; path: string }>) => {
    setUpdateFeedback('')
    try {
      const status = await action()
      setUpdateFeedback('message' in status ? status.message : `SAM LAB Setup opened on ${status.channel === 'main' ? 'Main' : 'Stable'}.`)
    } catch (error) {
      setUpdateFeedback(error instanceof Error ? error.message : 'The update action was stopped safely.')
    }
  }

  const chooseActiveSource = async (source: ActiveAiSource) => {
    setAiBusy(true)
    setAiFeedback('')
    try {
      await onSelectActiveAiSource(source)
      setAiFeedback(`${source === 'chatgpt' ? 'ChatGPT' : source === 'anthropic' ? 'Claude' : source === 'moonshot' ? 'Kimi' : 'OpenAI'} will run the next agent request.`)
    } catch (error) {
      notifyError(error, 'Unable to select the active agent source')
      setAiFeedback(error instanceof Error ? error.message : 'Unable to select the active agent source.')
    } finally { setAiBusy(false) }
  }

  const menu = (id: SettingsSection, label: string, detail: string, icon: React.ReactNode) => <button aria-current={activeSection === id ? 'page' : undefined} className={activeSection === id ? 'is-active' : ''} onClick={() => setActiveSection(id)} type="button">{icon}<span><strong>{label}</strong><small>{detail}</small></span></button>

  return <Modal ariaLabelledby="settings-title" className="settings-modal" onClose={onClose}>
    <header className="settings-heading">
      <span><Settings size={19} /></span>
      <div><small>WORKSPACE</small><h2 id="settings-title">Settings</h2><p>Connections, examples, appearance and safe graph history.</p></div>
      <button aria-label="Close settings" className="settings-close" onClick={onClose} type="button"><X size={18} /></button>
    </header>

    <div className="settings-body">
      <nav aria-label="Settings sections" className="settings-sidebar">
        <small>SETTINGS MENU</small>
        {menu('appearance', 'Appearance', 'Theme and interface', <Palette size={17} />)}
        {menu('workspaces', 'Workspaces', 'Save, switch and recover', <FolderKanban size={17} />)}
        {menu('ai', 'AI connection', 'Model and quality', <Bot size={17} />)}
        {menu('autonomy', 'Autonomy', 'Review and risk policy', <Gauge size={17} />)}
        {menu('connections', 'Connections', 'Catalog, MCP and API sources', <Database size={17} />)}
        {menu('updates', 'Updates', 'Signed stable and main builds', <Download size={17} />)}
        {menu('diagnostics', 'Diagnostics', 'Local, private and bounded', <Activity size={17} />)}
        {menu('presets', 'Examples', 'Start empty or explore', <LayoutTemplate size={17} />)}
        {menu('pipeline', 'Pipeline', 'Layout and validation', <Network size={17} />)}
        {menu('versions', 'Versions', 'Safe graph checkpoints', <History size={17} />)}
        <div className="settings-sidebar-status"><span className={activeSourceConnected ? 'connected' : 'demo'} /><div><strong>Active agent</strong><small>{activeSourceConnected ? activeSourceModel : `${activeAiSource} · not connected`}</small></div></div>
      </nav>

      <div className="settings-content">
        {activeSection === 'appearance' && <article className="settings-page">
          <div className="settings-page-heading"><small>APPEARANCE</small><h3>Choose your workspace theme</h3><p>Card identities stay distinct in both light and dark modes.</p></div>
          <section className="settings-section settings-appearance">
            <div className="settings-section-title"><span>Color mode</span><small>Local to this device</small></div>
            <div aria-label="Color theme" className="theme-switch" role="group">
              <button aria-pressed={theme === 'light'} className={theme === 'light' ? 'is-active' : ''} onClick={() => onThemeChange('light')} type="button"><Sun size={20} /><span><strong>Light</strong><small>Clear and bright workspace</small></span></button>
              <button aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'is-active' : ''} onClick={() => onThemeChange('dark')} type="button"><Moon size={20} /><span><strong>Dark</strong><small>Distinct colored cards on slate</small></span></button>
            </div>
          </section>
          <section className="settings-section settings-appearance">
            <div className="settings-section-title"><span><Languages size={15} /> Interface language</span><small>English by default · saved locally</small></div>
            <div aria-label="Interface language" className="theme-switch language-switch" role="group">
              <button aria-pressed={language === 'en'} className={language === 'en' ? 'is-active' : ''} onClick={() => setLanguage('en')} type="button"><span><strong>English</strong><small>Default interface and agent replies</small></span></button>
              <button aria-pressed={language === 'fr'} className={language === 'fr' ? 'is-active' : ''} onClick={() => setLanguage('fr')} type="button"><span><strong>Français</strong><small>Interface et réponses de l’agent</small></span></button>
            </div>
          </section>
        </article>}

        {activeSection === 'autonomy' && <article className="settings-page">
          <div className="settings-page-heading"><small>AUTONOMY</small><h3>Choose how the agent works alone</h3><p>These policies are persisted locally and included in every autonomous planning turn.</p></div>
          <section className="settings-section autonomy-settings">
            <div className="settings-section-title"><span><UserRound size={15} /> Human Review frequency</span><small>Native approval boundary</small></div>
            <div aria-label="Human Review frequency" className="autonomy-choice-grid" role="radiogroup">
              <button aria-checked={autonomyPolicy.humanReview === 'frequent'} className={autonomyPolicy.humanReview === 'frequent' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, humanReview: 'frequent' })} role="radio" type="button"><strong>Frequent</strong><small>Every material graph diff waits for approval.</small></button>
              <button aria-checked={autonomyPolicy.humanReview === 'risk-based'} className={autonomyPolicy.humanReview === 'risk-based' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, humanReview: 'risk-based' })} role="radio" type="button"><strong>Risk based</strong><small>Review uncertain, sensitive or structural changes.</small></button>
              <button aria-checked={autonomyPolicy.humanReview === 'critical-only'} className={autonomyPolicy.humanReview === 'critical-only' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, humanReview: 'critical-only' })} role="radio" type="button"><strong>Critical only</strong><small>Low-risk reversible graph work may continue alone.</small></button>
            </div>
          </section>
          <section className="settings-section autonomy-settings">
            <div className="settings-section-title"><span><ShieldCheck size={15} /> Risk analysis depth</span><small>Evidence-backed only</small></div>
            <div aria-label="Risk analysis depth" className="autonomy-choice-grid" role="radiogroup">
              <button aria-checked={autonomyPolicy.riskAnalysis === 'standard'} className={autonomyPolicy.riskAnalysis === 'standard' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, riskAnalysis: 'standard' })} role="radio" type="button"><strong>Standard</strong><small>Assess material downstream impacts.</small></button>
              <button aria-checked={autonomyPolicy.riskAnalysis === 'deep'} className={autonomyPolicy.riskAnalysis === 'deep' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, riskAnalysis: 'deep' })} role="radio" type="button"><strong>Deep</strong><small>Assess every material schema or lineage impact.</small></button>
              <button aria-checked={autonomyPolicy.riskAnalysis === 'exhaustive'} className={autonomyPolicy.riskAnalysis === 'exhaustive' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, riskAnalysis: 'exhaustive' })} role="radio" type="button"><strong>Exhaustive</strong><small>Classify each affected dataset, feature and model branch.</small></button>
            </div>
          </section>
          <section className="settings-section autonomy-settings">
            <div className="settings-section-title"><span><AlertTriangle size={15} /> Incomplete or conflicting evidence</span><small>Never invent a data incident</small></div>
            <div aria-label="Uncertainty policy" className="autonomy-choice-grid" role="radiogroup">
              <button aria-checked={autonomyPolicy.uncertainty === 'review'} className={autonomyPolicy.uncertainty === 'review' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, uncertainty: 'review' })} role="radio" type="button"><strong>Ask a human</strong><small>Pause only the uncertain branch at a checkpoint.</small></button>
              <button aria-checked={autonomyPolicy.uncertainty === 'no-change'} className={autonomyPolicy.uncertainty === 'no-change' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, uncertainty: 'no-change' })} role="radio" type="button"><strong>Report only</strong><small>Record the evidence gap and leave the graph unchanged.</small></button>
              <button aria-checked={autonomyPolicy.uncertainty === 'bounded'} className={autonomyPolicy.uncertainty === 'bounded' ? 'is-active' : ''} onClick={() => onAutonomyPolicyChange({ ...autonomyPolicy, uncertainty: 'bounded' })} role="radio" type="button"><strong>Bounded work</strong><small>Allow reversible graph-only work, never dataset claims.</small></button>
            </div>
          </section>
          <p className="settings-note">External mutations and DataHub write-back always keep their separate native confirmation, regardless of autonomy level.</p>
        </article>}

        {activeSection === 'workspaces' && <article className="settings-page">
          <div className="settings-page-heading"><small>WORKSPACES</small><h3>Local projects and recovery</h3><p>Each graph, version history and pending agent review stays isolated in its own SQLite workspace.</p></div>
          <WorkspaceManager activeWorkspaceId={activeWorkspaceId} onArchive={onArchiveWorkspace} onCreate={onCreateWorkspace} onDelete={onDeleteWorkspace} onDuplicate={onDuplicateWorkspace} onOpen={onOpenWorkspace} onRename={onRenameWorkspace} onSave={onSaveWorkspace} projectTitle={projectTitle} saveState={workspaceSaveState} workspaces={workspaces} />
        </article>}

        {activeSection === 'diagnostics' && <article className="settings-page">
          <div className="settings-page-heading"><small>DIAGNOSTICS</small><h3>Local diagnostic settings</h3><p>Choose how much technical history SAM LAB keeps on this device. Data incidents remain in Reports.</p></div>
          <section className="settings-section diagnostics-settings">
            <div className="diagnostics-privacy"><CheckCircle2 size={18} /><div><strong>Private by design</strong><small>External telemetry is disabled. Tokens, authorization headers and sensitive prompts are always redacted.</small></div></div>
            <div className="diagnostic-settings-grid">
              <label className="diagnostic-toggle"><input checked={diagnosticSettings.enabled} onChange={(event) => setDiagnosticSettings((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /><span><strong>Keep a local technical log</strong><small>Connection, provider, validation and workspace recovery events only.</small></span></label>
              <label className="settings-field"><span>Detail level</span><select disabled={!diagnosticSettings.enabled} onChange={(event) => setDiagnosticSettings((current) => ({ ...current, level: event.target.value as DiagnosticSettings['level'] }))} value={diagnosticSettings.level}><option value="all">All useful activity</option><option value="warnings">Warnings and errors</option><option value="errors">Errors only</option></select></label>
              <label className="settings-field"><span>Keep history for</span><select disabled={!diagnosticSettings.enabled} onChange={(event) => setDiagnosticSettings((current) => ({ ...current, retentionDays: Number(event.target.value) }))} value={diagnosticSettings.retentionDays}><option value={1}>1 day</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
              <label className="settings-field"><span>Maximum events</span><select disabled={!diagnosticSettings.enabled} onChange={(event) => setDiagnosticSettings((current) => ({ ...current, maximumEvents: Number(event.target.value) }))} value={diagnosticSettings.maximumEvents}><option value={100}>100</option><option value={500}>500</option><option value={1000}>1,000</option><option value={2000}>2,000</option></select></label>
            </div>
            <div className="diagnostic-storage-summary"><Activity size={17} /><div><strong>{diagnosticBundle?.events.length ?? 0} sanitized technical event{diagnosticBundle?.events.length === 1 ? '' : 's'} stored</strong><small>The agent receives only compact recent warnings and errors as reliability context. Raw secrets never enter its prompt.</small></div></div>
            <div className="report-storage-summary"><Trash2 size={17} /><div><strong>{incidentReportCount} incident report event{incidentReportCount === 1 ? '' : 's'} in this workspace</strong><small>Clear only the local Reports history. Graph cards, versions, diagnostics and other workspaces are preserved.</small></div><ActionButton className={reportsClearArmed ? 'is-confirming' : ''} disabled={diagnosticsBusy || incidentReportCount === 0} icon={<Trash2 size={14} />} onClick={() => void clearReports()} variant="ghost">{reportsClearArmed ? 'Confirm clear reports' : 'Clear incident reports'}</ActionButton></div>
            <div className="diagnostics-actions"><ActionButton disabled={diagnosticsBusy} icon={<Save size={14} />} onClick={() => void saveDiagnostics()} variant="primary">{diagnosticsBusy ? 'Saving…' : 'Save diagnostic settings'}</ActionButton><ActionButton disabled={diagnosticsBusy} icon={<RefreshCw className={diagnosticsBusy ? 'agent-context-wheel' : ''} size={14} />} onClick={() => void refreshDiagnostics()} variant="ghost">Refresh status</ActionButton><ActionButton icon={<FolderOpen size={15} />} onClick={() => void onOpenDiagnosticLogs()}>Open local logs</ActionButton><ActionButton icon={<FileDown size={15} />} onClick={() => void onExportDiagnostics()}>Export sanitized bundle</ActionButton></div>
          </section>
        </article>}

        {activeSection === 'ai' && <article className="settings-page">
          <div className="settings-page-heading"><small>AI CONNECTION</small><h3>Connect the real pipeline agent</h3><p>Without a provider connection, SAM LAB never generates a simulated proposal.</p></div>
          <section className="settings-section active-agent-source">
            <div className="settings-section-title"><span>Active agent source</span><small>Exactly one source runs each request</small></div>
            <div aria-label="Active agent source" className="model-grid active-source-grid" role="radiogroup">{([
              ['chatgpt', 'ChatGPT', chatGPTStatus.connected, chatGPTStatus.selectedModel ?? 'Account session'],
              ['openai', 'OpenAI', aiStatus.providers.openai.connected, aiStatus.providers.openai.model],
              ['anthropic', 'Claude', aiStatus.providers.anthropic.connected, aiStatus.providers.anthropic.model],
              ['moonshot', 'Kimi', aiStatus.providers.moonshot.connected, aiStatus.providers.moonshot.model],
            ] as const).map(([source, label, connected, model]) => <button aria-checked={activeAiSource === source} className={activeAiSource === source ? 'is-active' : ''} disabled={!connected || aiBusy} key={source} onClick={() => void chooseActiveSource(source)} role="radio" type="button"><strong>{label}</strong><small>{model}</small><code>{connected ? activeAiSource === source ? 'active' : 'ready' : 'connect first'}</code></button>)}</div>
          </section>
          <section className="settings-section chatgpt-connection-panel">
            <div className="settings-section-title"><span><UserRound size={15} /> ChatGPT account</span><small>{chatGPTStatus.connected ? 'Connected' : 'Optional'}</small></div>
            {chatGPTStatus.connected ? <>
              <div className="chatgpt-account-status"><CheckCircle2 size={19} /><div><strong>{chatGPTStatus.email ?? 'ChatGPT account connected'}</strong><small>{chatGPTStatus.planType ? `${chatGPTStatus.planType} plan` : 'Codex account session'} · no API key required</small></div></div>
              {chatGPTModel && <div className="ai-option-grid"><label className="settings-field"><span>ChatGPT model</span><select onChange={(event) => { const model = chatGPTStatus.models?.find((item) => item.id === event.target.value); if (model) void onConfigureChatGPT({ model: model.id, effort: model.defaultEffort ?? model.efforts[0] ?? '' }) }} value={chatGPTModel.id}>{chatGPTStatus.models?.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><label className="settings-field"><span>Reasoning</span><select disabled={!chatGPTModel.efforts.length} onChange={(event) => void onConfigureChatGPT({ model: chatGPTModel.id, effort: event.target.value })} value={chatGPTEffort}>{chatGPTModel.efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label></div>}
              <div className="ai-connection-actions"><ActionButton disabled={aiBusy} icon={<LogOut size={14} />} onClick={() => void disconnectChatGPTAccount()} variant="ghost">Disconnect ChatGPT</ActionButton></div>
            </> : <><p className="settings-feedback">Sign in with a dedicated SAM LAB Codex session. It does not reuse or expose another app’s credentials.</p>{chatGPTConnecting && <div aria-live="polite" className="connection-progress">
              <header><RefreshCw className="agent-context-wheel" size={15} /><div><strong>Connecting ChatGPT</strong><small>{chatGPTElapsed}s · this panel updates from the real Electron session</small></div></header>
              <ol><li className="is-complete"><CheckCircle2 size={13} /><span><strong>Session opened</strong><small>Dedicated local Codex process started</small></span></li><li className="is-active"><span className="connection-pulse" /><span><strong>Browser approval</strong><small>Waiting for or detecting your ChatGPT approval</small></span></li><li className={chatGPTStatus.connected ? 'is-complete' : ''}><span className="connection-step-dot" /><span><strong>Account &amp; models</strong><small>Status is polled every 500 ms</small></span></li></ol>
            </div>}<div className="ai-connection-actions">{chatGPTConnecting
              ? <ActionButton icon={<X size={14} />} onClick={() => void cancelChatGPTAccountLogin()} variant="ghost">Cancel ChatGPT sign-in</ActionButton>
              : <ActionButton disabled={aiBusy} icon={<LogIn size={14} />} onClick={() => void connectChatGPTAccount()} variant="primary">Continue with ChatGPT</ActionButton>}</div>{chatGPTStatus.error && <p className="settings-feedback">{chatGPTStatus.error} · You can retry the connection.</p>}</>}
          </section>
          <section className="settings-section ai-connection-panel">
            <div className="settings-section-title"><span>API providers</span><small>{aiStatus.providers[aiSettings.provider].connected ? `Connected · ${aiStatus.providers[aiSettings.provider].credentialSource}` : 'Not connected'}</small></div>
            <div className="model-grid provider-grid" role="radiogroup" aria-label="API provider">{([['openai', 'OpenAI', 'Responses API'], ['anthropic', 'Claude', 'Anthropic Messages'], ['moonshot', 'Kimi', 'Moonshot API']] as const).map(([provider, label, detail]) => <button aria-checked={aiSettings.provider === provider} className={aiSettings.provider === provider ? 'is-active' : ''} key={provider} onClick={() => chooseProvider(provider)} role="radio" type="button"><strong>{label}</strong><small>{detail}</small><code>{aiStatus.providers[provider].connected ? 'connected' : 'API key'}</code></button>)}</div>
            <label className="settings-field"><span><KeyRound size={14} /> {aiSettings.provider === 'anthropic' ? 'Anthropic' : aiSettings.provider === 'moonshot' ? 'Moonshot' : 'OpenAI'} API key</span><input autoComplete="off" defaultValue="" key={`api-key-${aiSettings.provider}`} placeholder={aiStatus.providers[aiSettings.provider].connected ? 'Saved securely · enter only to replace' : 'Paste key locally…'} ref={apiKeyRef} type="password" /><small>The key stays encrypted in Electron secure storage and is never exposed back to React.</small></label>
            <label className="settings-field"><span>Model ID</span><input defaultValue={aiSettings.model} key={`model-${aiSettings.provider}`} list={`models-${aiSettings.provider}`} placeholder="Model returned by this provider" ref={modelIdRef} type="text" /><datalist id={`models-${aiSettings.provider}`}>{selectedProviderStatus.catalog.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist><small>{selectedProviderStatus.modelUnavailable ? 'This manual model is not in the latest catalog; it is preserved but may be unavailable.' : selectedCapabilities.deprecated ? 'This model appears deprecated. Refresh the catalog and choose a supported replacement.' : selectedProviderStatus.catalogRefreshedAt ? `Catalog refreshed ${new Date(selectedProviderStatus.catalogRefreshedAt).toLocaleString()}.` : 'Refresh models to discover supported capabilities. Manual IDs are preserved.'}</small></label>
            <div className="ai-option-grid">
              <label className="settings-field"><span>Reasoning quality</span><select disabled={!selectedCapabilities.reasoning} onChange={(event) => setAiSettings((current) => ({ ...current, reasoningEffort: event.target.value as AiSettings['reasoningEffort'] }))} value={aiSettings.reasoningEffort}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option></select><small>{selectedCapabilities.reasoning ? 'Supported by this model.' : 'Unavailable for this provider/model.'}</small></label>
              <label className="settings-field"><span>Answer detail</span><select disabled={!selectedCapabilities.verbosity} onChange={(event) => setAiSettings((current) => ({ ...current, verbosity: event.target.value as AiSettings['verbosity'] }))} value={aiSettings.verbosity}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select><small>{selectedCapabilities.verbosity ? 'Supported by this model.' : 'Unavailable for this provider/model.'}</small></label>
              <label className="settings-field"><span>Service speed</span><select disabled={!selectedCapabilities.serviceTier} onChange={(event) => setAiSettings((current) => ({ ...current, serviceTier: event.target.value as AiSettings['serviceTier'] }))} value={aiSettings.serviceTier}><option value="auto">Auto</option><option value="priority">Priority (if enabled)</option></select><small>{selectedCapabilities.serviceTier ? 'Provider tier selection is available.' : 'Provider-managed for this model.'}</small></label>
            </div>
            <div className="ai-connection-actions"><ActionButton disabled={aiBusy || selectedProviderStatus.credentialSource !== 'encrypted'} onClick={removeProviderKey} variant="ghost">Remove saved key</ActionButton><ActionButton disabled={aiBusy || !selectedProviderStatus.connected} icon={<RefreshCw size={14} />} onClick={refreshModels} variant="ghost">Refresh models</ActionButton><ActionButton disabled={aiBusy} onClick={saveAi} variant="ghost">Save settings</ActionButton><ActionButton disabled={aiBusy} onClick={testAi} variant="primary">{aiBusy ? 'Checking…' : 'Test connection'}</ActionButton></div>
            {aiFeedback && <p aria-live="polite" className="settings-feedback">{aiFeedback}</p>}
          </section>
          <p className="settings-note">Choose either a ChatGPT account or an API provider. If ChatGPT is connected, SAM LAB uses that account first; disconnect it to use the selected API provider.</p>
        </article>}

        {activeSection === 'connections' && <article className="settings-page">
          <div className="settings-page-heading"><small>CONNECTIONS</small><h3>Catalog and evidence sources</h3><p>Connect normalized MCP or HTTP API catalogs without coupling pipeline cards to a vendor.</p></div>
          <section className="settings-section">
            <div className="settings-section-title"><span>Built-in · DataHub</span><small>{mcpTransport === 'demo' ? 'Not configured' : mcpTransport === 'http' ? 'Remote MCP' : 'GraphQL GMS + local MCP'}</small></div>
            <div className="settings-setting-row"><div className={`settings-icon datahub-${connectionMode}`}><Database size={19} /></div><div><strong>DataHub {connectionMode === 'connected' ? 'connected' : 'not connected'}</strong><p>{mcpMessage}</p></div><ActionButton disabled={dataHubBusy || connectionMode !== 'connected'} onClick={() => void onSyncDataHub()} variant="ghost">Sync now</ActionButton></div>
            <div className="ai-option-grid">
              <label className="settings-field"><span>Transport</span><select onChange={(event) => setDataHubTransport(event.target.value as 'http' | 'stdio')} value={dataHubTransport}><option value="stdio">Local stdio (DataHub OSS)</option><option value="http">Streamable HTTP MCP</option></select><small>{dataHubTransport === 'stdio' ? 'Launches mcp-server-datahub locally through uvx; quickstart works without a token.' : 'Connects to an already hosted MCP endpoint.'}</small></label>
              <label className="settings-field"><span>{dataHubTransport === 'stdio' ? 'DataHub GMS URL' : 'MCP server URL'}</span><input defaultValue={dataHubSettings.url} key={`datahub-url-${dataHubSettings.url}`} placeholder={dataHubTransport === 'stdio' ? 'http://localhost:8080' : 'https://mcp.example.com/mcp'} ref={dataHubUrlRef} type="url" /><small>Only HTTP or HTTPS endpoints are accepted.</small></label>
              <label className="settings-field"><span>Dataset read route</span><select disabled={dataHubTransport === 'http'} onChange={(event) => setDataHubCatalogReadRoute(event.target.value as 'auto' | 'gms' | 'mcp')} value={dataHubTransport === 'http' ? 'mcp' : dataHubCatalogReadRoute}><option value="auto">Auto · GraphQL for local Docker</option><option value="gms">GraphQL GMS only</option><option value="mcp">MCP tools only</option></select><small>{dataHubTransport === 'http' ? 'Remote Streamable HTTP uses the MCP endpoint.' : 'GraphQL reads catalog batches, schema and lineage directly. MCP remains available for agent tools and governed write-back.'}</small></label>
            </div>
            <label className="settings-field"><span>Personal access token <em>optional for local OSS</em></span><input autoComplete="off" placeholder={dataHubSettings.tokenConfigured ? 'Token configured · enter a new value to rotate' : 'Leave empty for an unauthenticated local quickstart'} ref={dataHubTokenRef} type="password" /><small>{dataHubSettings.tokenSource === 'encrypted' ? 'Stored with the operating system secure credential service.' : dataHubSettings.tokenSource === 'environment' ? 'Loaded from the launch environment; never exposed to the renderer.' : dataHubTransport === 'stdio' ? 'Your current quickstart has token authentication disabled, so this field can stay empty.' : dataHubSettings.encryptionAvailable ? 'Hosted endpoints generally require a token; it will be encrypted before SQLite persistence.' : 'Secure credential storage is unavailable; SAM LAB will refuse to save a token.'}</small></label>
            <label className="datahub-writeback-toggle"><span><strong>Approved DataHub write-back</strong><small>Disabled by default. A local connection uses GraphQL <code>createDocument</code>; remote MCP uses its explicitly advertised mutation. Both require the exact native human confirmation.</small></span><input checked={dataHubWriteback} onChange={(event) => setDataHubWriteback(event.target.checked)} type="checkbox" /></label>
            <div className="ai-connection-actions"><ActionButton disabled={dataHubBusy || !dataHubSettings.tokenConfigured} onClick={() => void removeDataHubToken()} variant="ghost">Remove saved token</ActionButton><ActionButton disabled={dataHubBusy} icon={<Database size={14} />} onClick={() => void saveAndConnectDataHub()} variant="primary">{dataHubBusy ? 'Connecting…' : 'Save & connect'}</ActionButton></div>
            {dataHubFeedback && <p aria-live="polite" className="settings-feedback">{dataHubFeedback}</p>}
          </section>
          <section className="settings-section">
            <div className="settings-section-title"><span>Custom catalog.v1 connections</span><small>{catalogConnectors.filter((connector) => !connector.builtIn).length} configured</small></div>
            <p className="settings-feedback">A connector stays outside the graph. It must expose normalized <code>catalog_search</code>/<code>catalog_inspect</code> MCP tools or the HTTP endpoints <code>/catalog/search</code> and <code>/catalog/assets</code>.</p>
            <div className="model-grid provider-grid">
              {catalogConnectors.filter((connector) => !connector.builtIn).map((connector) => <div className="catalog-connector-card" key={connector.id}>
                <span><strong>{connector.name}</strong><small>{connector.kind} · {connector.id}</small><code>{connector.enabled ? 'enabled' : 'disabled'} · {connector.tokenConfigured ? 'secure token' : 'no token'}</code></span>
                <div className="ai-connection-actions"><ActionButton disabled={dataHubBusy} onClick={() => void testCustomConnector(connector.id)} variant="ghost">Test</ActionButton><ActionButton disabled={dataHubBusy} icon={<Trash2 size={13} />} onClick={() => void deleteCustomConnector(connector.id)} variant="ghost">Remove</ActionButton></div>
              </div>)}
            </div>
            <div className="ai-option-grid">
              <label className="settings-field"><span>Connector ID</span><input placeholder="snowflake-catalog" ref={catalogIdRef} type="text" /><small>Stable lowercase ID used as neutral card provenance.</small></label>
              <label className="settings-field"><span>Display name</span><input placeholder="Snowflake Catalog" ref={catalogNameRef} type="text" /></label>
              <label className="settings-field"><span>Protocol</span><select onChange={(event) => setCatalogKind(event.target.value as CatalogConnectorKind)} value={catalogKind}><option value="mcp">MCP · Streamable HTTP</option><option value="http-api">HTTP API · catalog.v1</option></select></label>
              <label className="settings-field"><span>Endpoint</span><input placeholder={catalogKind === 'mcp' ? 'https://catalog.example.com/mcp' : 'https://catalog.example.com'} ref={catalogUrlRef} type="url" /><small>HTTPS required; HTTP is accepted only on loopback.</small></label>
            </div>
            <label className="settings-field"><span>Bearer token <em>optional</em></span><input autoComplete="off" placeholder="Stored in the operating system credential service" ref={catalogTokenRef} type="password" /><small>Never included in a card, manifest export or renderer response.</small></label>
            <div className="ai-connection-actions"><ActionButton disabled={dataHubBusy} icon={<Database size={14} />} onClick={() => void saveCustomConnector()} variant="primary">Add connection</ActionButton></div>
            {catalogFeedback && <p aria-live="polite" className="settings-feedback">{catalogFeedback}</p>}
          </section>
        </article>}

        {activeSection === 'updates' && <article className="settings-page">
          <div className="settings-page-heading"><small>APPLICATION UPDATES</small><h3>Setup and signed updates</h3><p>Source-built Setup remains usable on unsigned builds. Automatic binary updates keep strict signature enforcement.</p></div>
          <section className="settings-section update-settings">
            <div className="settings-section-title"><span><FolderOpen size={15} /> Source-built Setup</span><small>Available</small></div>
            <div className="update-trust update-trusted"><CheckCircle2 size={19} /><div><strong>Setup updater is available</strong><small>Choose Stable or Main, then let Setup rebuild locally. This path does not weaken the signed binary policy.</small></div></div>
            <div aria-label="Application update channel" className="theme-switch update-channel-switch" role="radiogroup">
              <button aria-checked={appUpdateStatus.channel === 'stable'} className={appUpdateStatus.channel === 'stable' ? 'is-active' : ''} disabled={appUpdateBusy} onClick={() => void runUpdateAction(() => onSetAppUpdateChannel('stable'))} role="radio" type="button"><span><strong>Stable</strong><small>Latest published SAM LAB application release.</small></span></button>
              <button aria-checked={appUpdateStatus.channel === 'main'} className={appUpdateStatus.channel === 'main' ? 'is-active' : ''} disabled={appUpdateBusy} onClick={() => void runUpdateAction(() => onSetAppUpdateChannel('main'))} role="radio" type="button"><span><strong>Main preview</strong><small>Newest main commit; locally rebuilt by Setup.</small></span></button>
            </div>
            <div className="ai-connection-actions"><ActionButton icon={<FolderOpen size={14} />} onClick={() => void runUpdateAction(onOpenSetupUpdater)} variant="primary">Open Setup updater</ActionButton></div>
          </section>
          <section className="settings-section update-settings">
            <div className="settings-section-title"><span><ShieldCheck size={15} /> Signed automatic feed</span><small>Installed {appUpdateStatus.currentVersion}</small></div>
            <div className={`update-trust update-${appUpdateStatus.currentSignatureVerified ? 'trusted' : 'blocked'}`}><ShieldCheck size={19} /><div><strong>{appUpdateStatus.currentSignatureVerified ? 'Desktop signature verified' : appUpdateStatus.phase === 'unavailable' ? 'Desktop release required' : 'Signed feed unavailable for this build'}</strong><small>{appUpdateStatus.message}</small></div></div>
            <dl className="update-version-grid"><div><dt>Installed</dt><dd>{appUpdateStatus.currentVersion}</dd></div><div><dt>Available</dt><dd>{appUpdateStatus.availableVersion ?? 'Not checked'}</dd></div><div><dt>Signature policy</dt><dd>{appUpdateStatus.downloadedSignatureEnforced ? 'Enforced' : 'Unavailable'}</dd></div><div><dt>Status</dt><dd>{appUpdateStatus.phase}</dd></div></dl>
            {appUpdateStatus.progress !== undefined && <div className="update-progress"><span style={{ width: `${appUpdateStatus.progress}%` }} /><small>{Math.round(appUpdateStatus.progress)}%</small></div>}
            <div className="ai-connection-actions"><ActionButton disabled={appUpdateBusy || !appUpdateStatus.canCheck} icon={<RefreshCw size={14} />} onClick={() => void runUpdateAction(onCheckForAppUpdate)} variant="ghost">Check signed feed</ActionButton><ActionButton disabled={appUpdateBusy || !appUpdateStatus.canDownload} icon={<Download size={14} />} onClick={() => void runUpdateAction(onDownloadAppUpdate)} variant="ghost">Download signed</ActionButton><ActionButton disabled={appUpdateBusy || !appUpdateStatus.canInstall} icon={<Play size={14} />} onClick={() => void runUpdateAction(onInstallAppUpdate)} variant="ghost">Restart &amp; install</ActionButton></div>
            {(updateFeedback || appUpdateStatus.error) && <p aria-live="polite" className="settings-feedback">{appUpdateStatus.error ?? updateFeedback}</p>}
          </section>
          <p className="settings-note">Setup locally builds the selected channel and remembers it. Only the separate automatic feed requires a signed and notarized production build.</p>
        </article>}

        {activeSection === 'presets' && <article className="settings-page">
          <div className="settings-page-heading"><small>EXAMPLES</small><h3>Choose a starting canvas</h3><p>SAM LAB always opens empty. Examples are loaded only when you request them.</p></div>
          <section className="settings-section preset-grid">
            <button onClick={() => onLoadPreset('empty')} type="button"><LayoutTemplate size={21} /><strong>Empty workbench</strong><small>Start from a blank portfolio and add only the SAM stages you need.</small></button>
            <button onClick={() => onLoadPreset('license-reclamation')} type="button"><Database size={21} /><strong>Copilot license optimization</strong><small>Analyze a DataHub-backed 250-seat Copilot dataset and review USD 9,348 in annual savings.</small></button>
            <button onClick={() => onLoadPreset('compliance-exposure')} type="button"><KeyRound size={21} /><strong>Entitlement compliance</strong><small>Compare assignments to contracts and route material exposure to review.</small></button>
            <button onClick={() => onLoadPreset('renewal-optimization')} type="button"><Network size={21} /><strong>Renewal optimization</strong><small>Rank upcoming renewals by cost, utilization and evidence coverage.</small></button>
            <button onClick={() => onLoadPreset('broken-governance')} type="button"><AlertTriangle size={21} /><strong>Evidence gap lab</strong><small>Explore how missing ownership and failing evidence block a decision.</small></button>
          </section>
        </article>}

        {activeSection === 'pipeline' && <article className="settings-page">
          <div className="settings-page-heading"><small>PIPELINE</small><h3>Graph tools and validation</h3><p>Maintain a readable topology and verify every rule atomically.</p></div>
          <section className="settings-section"><div className="settings-section-title"><span>Pipeline tools</span><small>Safe workspace actions</small></div><div className="settings-tools"><button onClick={onAutoLayout} type="button"><span><Network size={18} /></span><div><strong>Auto layout</strong><small>Recalculate topology-aware XY placement.</small></div></button><button onClick={onValidate} type="button"><span><Play size={18} /></span><div><strong>Run validation</strong><small>{findingCount} findings · {errorCount} blocking.</small></div><em className={errorCount ? 'has-errors' : 'is-clear'}>{errorCount ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}</em></button><button onClick={onExportPipeline} type="button"><span><Save size={18} /></span><div><strong>Export JSON</strong><small>Download a versioned, non-secret pipeline artifact.</small></div></button><label className="settings-import-file"><span><LayoutTemplate size={18} /></span><div><strong>Import JSON</strong><small>Validate the complete file before replacing this workspace.</small></div><input accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportPipeline(file); event.target.value = '' }} type="file" /></label></div></section>
        </article>}

        {activeSection === 'versions' && <article className="settings-page">
          <div className="settings-page-heading settings-heading-with-action"><div><small>VERSIONS</small><h3>Pipeline checkpoints</h3><p>Recent versions are supplied to the connected model so it proposes incremental changes.</p></div><ActionButton icon={<Save size={15} />} onClick={onSaveVersion} variant="primary">Save checkpoint</ActionButton></div>
          <VersionBrowser onApprove={onApprovePendingReview} onEmergencyStop={onEmergencyStop} onReject={onRejectPendingReview} onRemind={onRemindHumanReview} onRestore={onRestoreVersion} pipelineTitle={projectTitle} selectedVersionId={selectedVersionId} versions={versions} />
        </article>}
      </div>
    </div>
  </Modal>
}
