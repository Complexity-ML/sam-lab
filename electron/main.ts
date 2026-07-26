import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, type MenuItemConstructorOptions } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDataHubStatus, loadDatasetContext } from './datahub.js'
import { auditDataHubWithMcp, closeDataHubMcp, connectDataHubMcp, getDataHubMcpConfigurationStatus, inspectDataHubAsset, invalidateDataHubContext, parseDataHubDecisionRequest, saveDataHubMcpSettings, searchDataHubAssets, writeDataHubDecision } from './datahub-mcp.js'
import { cancelAiProposal, getAiStatus, refreshAiModelCatalog, runAiProposal, saveAiSettings, testAiConnection } from './ai-provider.js'
import { ChatGPTAgentSession } from './chatgpt-session.js'
import { archiveWorkspace, autosaveWorkspaceDraft, beginWorkspaceSession, clearIncidentEvents, closeWorkspaceDatabase, commitActiveWorkspace, createWorkspace, deleteWorkspace, duplicateWorkspace, listAgentProposalMemory, listIncidentEvents, loadAppSetting, loadCatalogCheckpoint, loadWorkspaceManagerState, markWorkspaceSessionClean, openWorkspace, recordIncidentEvent, rememberAgentProposal, renameWorkspace, resolveWorkspaceRecovery, saveAppSetting, saveCatalogCheckpoint, updateAgentProposalMemoryStatus } from './workspace-db.js'
import { parseActiveAiSource, requireSelectableAiSource, type ActiveAiSource } from './active-ai-source.js'
import { reserveHumanReviewNotification } from './human-review-notifications.js'
import { ensureDiagnosticLog, exportDiagnosticBundle, loadDiagnosticSettings, recordDiagnosticEvent, saveDiagnosticSettings } from './diagnostics.js'
import { AppUpdateController } from './app-updater.js'
import { parseUpdateChannel } from './update-policy.js'
import { desktopWindowFrame } from './window-platform.js'
import { openSetupUpdater, readSetupChannel, saveSetupChannel } from './setup-updater.js'
import { deleteCatalogConnector, inspectCatalogAsset, listCatalogConnectors, saveCatalogConnector, searchCatalogAssets, testCatalogConnector } from './catalog-connectors.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const statusChannel = 'sam-lab:datahub-status'
const datasetChannel = 'sam-lab:datahub-dataset'
const mcpStatusChannel = 'sam-lab:datahub-mcp-status'
const mcpConnectChannel = 'sam-lab:datahub-mcp-connect'
const mcpSettingsSaveChannel = 'sam-lab:datahub-mcp-settings-save'
const mcpAuditChannel = 'sam-lab:datahub-mcp-audit'
const mcpSearchChannel = 'sam-lab:datahub-mcp-search'
const mcpInspectChannel = 'sam-lab:datahub-mcp-inspect'
const mcpInvalidateChannel = 'sam-lab:datahub-mcp-invalidate'
const mcpWritebackChannel = 'sam-lab:datahub-mcp-writeback'
const catalogConnectorsListChannel = 'sam-lab:catalog-connectors-list'
const catalogConnectorSaveChannel = 'sam-lab:catalog-connector-save'
const catalogConnectorDeleteChannel = 'sam-lab:catalog-connector-delete'
const catalogConnectorTestChannel = 'sam-lab:catalog-connector-test'
const catalogSearchChannel = 'sam-lab:catalog-search'
const catalogInspectChannel = 'sam-lab:catalog-inspect'
const humanReviewNotificationChannel = 'sam-lab:human-review-notification'
const windowStateChannel = 'sam-lab:window-state'
const windowStateChangedChannel = 'sam-lab:window-state-changed'
const aiStatusChannel = 'sam-lab:ai-status'
const aiSaveChannel = 'sam-lab:ai-save'
const aiTestChannel = 'sam-lab:ai-test'
const aiCatalogRefreshChannel = 'sam-lab:ai-catalog-refresh'
const aiProposalChannel = 'sam-lab:ai-proposal'
const aiCancelChannel = 'sam-lab:ai-cancel'
const humanReviewOpenedChannel = 'sam-lab:human-review-opened'
const chatGPTStatusChannel = 'sam-lab:chatgpt-status'
const chatGPTConnectChannel = 'sam-lab:chatgpt-connect'
const chatGPTLoginCancelChannel = 'sam-lab:chatgpt-login-cancel'
const chatGPTDisconnectChannel = 'sam-lab:chatgpt-disconnect'
const chatGPTConfigureChannel = 'sam-lab:chatgpt-configure'
const chatGPTProposalChannel = 'sam-lab:chatgpt-proposal'
const chatGPTCancelChannel = 'sam-lab:chatgpt-cancel'
const workspaceLoadChannel = 'sam-lab:workspace-load'
const workspaceCreateChannel = 'sam-lab:workspace-create'
const workspaceRenameChannel = 'sam-lab:workspace-rename'
const workspaceDuplicateChannel = 'sam-lab:workspace-duplicate'
const workspaceArchiveChannel = 'sam-lab:workspace-archive'
const workspaceDeleteChannel = 'sam-lab:workspace-delete'
const workspaceOpenChannel = 'sam-lab:workspace-open'
const workspaceAutosaveChannel = 'sam-lab:workspace-autosave'
const workspaceCommitChannel = 'sam-lab:workspace-commit'
const workspaceRecoveryChannel = 'sam-lab:workspace-recovery'
const catalogCheckpointLoadChannel = 'sam-lab:catalog-checkpoint-load'
const catalogCheckpointSaveChannel = 'sam-lab:catalog-checkpoint-save'
const proposalMemoryListChannel = 'sam-lab:proposal-memory-list'
const proposalMemoryRememberChannel = 'sam-lab:proposal-memory-remember'
const proposalMemoryStatusChannel = 'sam-lab:proposal-memory-status'
const activeAiSourceChannel = 'sam-lab:active-ai-source'
const activeAiSourceSaveChannel = 'sam-lab:active-ai-source-save'
const diagnosticsRecordChannel = 'sam-lab:diagnostics-record'
const diagnosticsExportChannel = 'sam-lab:diagnostics-export'
const diagnosticsOpenChannel = 'sam-lab:diagnostics-open'
const diagnosticsSettingsChannel = 'sam-lab:diagnostics-settings'
const diagnosticsSettingsSaveChannel = 'sam-lab:diagnostics-settings-save'
const incidentsListChannel = 'sam-lab:incidents-list'
const incidentsRecordChannel = 'sam-lab:incidents-record'
const incidentsClearChannel = 'sam-lab:incidents-clear'
const applicationRestartChannel = 'sam-lab:application-restart'
const appUpdateStatusChannel = 'sam-lab:app-update-status'
const appUpdateStatusChangedChannel = 'sam-lab:app-update-status-changed'
const appUpdateSetChannel = 'sam-lab:app-update-set-channel'
const appUpdateCheckChannel = 'sam-lab:app-update-check'
const appUpdateDownloadChannel = 'sam-lab:app-update-download'
const appUpdateInstallChannel = 'sam-lab:app-update-install'
const appUpdateOpenSetupChannel = 'sam-lab:app-update-open-setup'
let mainWindow: BrowserWindow | undefined
let isQuitting = false
let chatGPT: ChatGPTAgentSession | undefined
let appUpdates: AppUpdateController | undefined
let workspaceSessionWasUnclean = false

app.setName('SAM LAB')

function configureApplicationMenu() {
  if (process.platform !== 'darwin') return
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'SAM LAB',
      submenu: [
        {
          label: 'About SAM LAB',
          click: () => { void dialog.showMessageBox({ title: 'About SAM LAB', message: 'SAM LAB', detail: `Context-aware pipeline studio\nVersion ${app.getVersion()}`, buttons: ['OK'] }) },
        },
        { type: 'separator' },
        { label: 'Open SAM LAB', accelerator: 'CmdOrCtrl+0', click: focusMainWindow },
        { role: 'services' },
        { type: 'separator' },
        { label: 'Hide SAM LAB', role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit SAM LAB', role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'DataHub documentation', click: () => void shell.openExternal('https://docs.datahub.com/') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function currentActiveAiSource(): ActiveAiSource {
  const saved = loadAppSetting(app.getPath('userData'), 'active-ai-provider')
  return parseActiveAiSource(saved) ?? 'openai'
}

async function selectActiveAiSource(payload: { source?: unknown }) {
  const [apiStatus, chatGPTStatus] = await Promise.all([getAiStatus(), chatGPT?.status()])
  const source = requireSelectableAiSource(payload?.source, { chatgpt: Boolean(chatGPTStatus?.connected), openai: apiStatus.providers.openai.connected, anthropic: apiStatus.providers.anthropic.connected, moonshot: apiStatus.providers.moonshot.connected })
  if (source !== 'chatgpt') await saveAiSettings({ provider: source })
  saveAppSetting(app.getPath('userData'), 'active-ai-provider', source)
  return { source }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function notifyHumanReview(payload: { cardLabel?: unknown; reason?: unknown; versionId?: unknown; remind?: unknown }): { shown: boolean; deduplicated?: boolean } {
  const cardLabel = typeof payload?.cardLabel === 'string' ? payload.cardLabel.trim().slice(0, 120) : 'Agent flow'
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim().slice(0, 280) : 'The agent needs a human decision.'
  const versionId = typeof payload?.versionId === 'string' ? payload.versionId.trim().slice(0, 180) : undefined
  if (!Notification.isSupported()) return { shown: false }
  const reservation = reserveHumanReviewNotification(app.getPath('userData'), versionId, payload?.remind === true)
  if (!reservation.allowed) return { shown: false, deduplicated: true }

  const notification = new Notification({
    title: 'SAM LAB · Human review required',
    body: `${cardLabel} — ${reason}`,
  })
  notification.on('click', () => {
    focusMainWindow()
    mainWindow?.webContents.send(humanReviewOpenedChannel, { versionId })
  })
  notification.show()
  return { shown: true }
}

function createMainWindow() {
  const platformFrame = desktopWindowFrame(process.platform)
  const window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f8fafc',
    title: 'SAM LAB',
    ...platformFrame,
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window

  const developmentUrl = process.env.VITE_DEV_SERVER_URL
  const isTrustedRendererUrl = (target: string) => {
    try {
      const parsed = new URL(target)
      if (developmentUrl) return parsed.origin === new URL(developmentUrl).origin
      return parsed.protocol === 'file:' && decodeURIComponent(parsed.pathname).endsWith('/dist/index.html')
    } catch { return false }
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => { if (!isTrustedRendererUrl(target)) event.preventDefault() })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const publishWindowState = () => {
    if (!window.isDestroyed()) window.webContents.send(windowStateChangedChannel, { fullscreen: window.isFullScreen() })
  }
  window.on('enter-full-screen', publishWindowState)
  window.on('leave-full-screen', publishWindowState)

  if (process.platform === 'darwin') {
    window.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      app.quit()
    })
  }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  if (developmentUrl) void window.loadURL(developmentUrl)
  else void window.loadFile(join(currentDirectory, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  workspaceSessionWasUnclean = beginWorkspaceSession(app.getPath('userData'))
  configureApplicationMenu()
  const persistedUpdateChannel = parseUpdateChannel(readSetupChannel(app.getPath('userData')) ?? loadAppSetting(app.getPath('userData'), 'app-update-channel'))
  saveAppSetting(app.getPath('userData'), 'app-update-channel', persistedUpdateChannel)
  appUpdates = new AppUpdateController({
    channel: persistedUpdateChannel,
    currentVersion: app.getVersion(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    window: () => mainWindow,
    statusChannel: appUpdateStatusChangedChannel,
  })
  chatGPT = new ChatGPTAgentSession((url) => shell.openExternal(url), app.getVersion(), join(app.getPath('userData'), 'chatgpt-agent'))
  ipcMain.handle(statusChannel, () => getDataHubStatus())
  ipcMain.handle(datasetChannel, (_event, payload: { urn?: unknown }) => {
    if (typeof payload?.urn !== 'string') throw new Error('Invalid DataHub dataset request')
    return loadDatasetContext(payload.urn)
  })
  ipcMain.handle(mcpStatusChannel, () => getDataHubMcpConfigurationStatus())
  ipcMain.handle(mcpConnectChannel, () => connectDataHubMcp())
  ipcMain.handle(mcpSettingsSaveChannel, (_event, payload: unknown) => saveDataHubMcpSettings(payload))
  ipcMain.handle(mcpAuditChannel, (_event, payload: { urn?: unknown; force?: unknown }) => {
    if (typeof payload?.urn !== 'string') throw new Error('Invalid DataHub MCP audit request')
    return auditDataHubWithMcp(payload.urn, payload.force === true)
  })
  ipcMain.handle(mcpSearchChannel, (_event, payload: { query?: unknown }) => {
    if (typeof payload?.query !== 'string') throw new Error('Invalid DataHub search request')
    return searchDataHubAssets(payload.query)
  })
  ipcMain.handle(mcpInspectChannel, (_event, payload: { urn?: unknown; force?: unknown; mode?: unknown }) => {
    if (typeof payload?.urn !== 'string') throw new Error('Invalid DataHub inspection request')
    return inspectDataHubAsset(payload.urn, payload.force === true, payload.mode === 'summary' ? 'summary' : 'deep')
  })
  ipcMain.handle(mcpInvalidateChannel, (_event, payload: { urn?: unknown }) => invalidateDataHubContext(typeof payload?.urn === 'string' ? payload.urn : undefined))
  ipcMain.handle(catalogConnectorsListChannel, () => listCatalogConnectors())
  ipcMain.handle(catalogConnectorSaveChannel, (_event, payload: unknown) => saveCatalogConnector(payload))
  ipcMain.handle(catalogConnectorDeleteChannel, (_event, payload: { id?: unknown }) => deleteCatalogConnector(payload?.id))
  ipcMain.handle(catalogConnectorTestChannel, (_event, payload: { id?: unknown }) => testCatalogConnector(payload?.id))
  ipcMain.handle(catalogSearchChannel, (_event, payload: { query?: unknown }) => searchCatalogAssets(payload?.query))
  ipcMain.handle(catalogInspectChannel, (_event, payload: { connectorId?: unknown; assetRef?: unknown; force?: unknown; mode?: unknown }) => inspectCatalogAsset(payload?.connectorId, payload?.assetRef, payload?.force === true, payload?.mode))
  ipcMain.handle(mcpWritebackChannel, async (event, payload: unknown) => {
    const request = parseDataHubDecisionRequest(payload)
    const writebackOperation = getDataHubMcpConfigurationStatus().settings.transport === 'stdio'
      ? 'createDocument · GraphQL GMS'
      : 'save_document · MCP'
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      title: 'Confirm DataHub write-back',
      message: 'Publish this approved Decision to DataHub?',
      detail: `Operation: ${writebackOperation}\nRevision: ${request.revisionId}\nTitle: SAM LAB · ${request.title}\nRelated assets: ${request.relatedAssets.length}\n\nThis is an external mutation and cannot be undone by restoring the local graph.`,
      buttons: ['Publish to DataHub', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const confirmation = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (confirmation.response !== 0) throw new Error('DataHub write-back cancelled before any external mutation')
    return writeDataHubDecision(request)
  })
  ipcMain.handle(humanReviewNotificationChannel, (_event, payload: { cardLabel?: unknown; reason?: unknown; versionId?: unknown; remind?: unknown }) => notifyHumanReview(payload))
  ipcMain.handle(windowStateChannel, (event) => ({ fullscreen: BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false }))
  ipcMain.handle(aiStatusChannel, () => getAiStatus())
  ipcMain.handle(aiSaveChannel, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid AI settings request')
    return saveAiSettings(payload)
  })
  ipcMain.handle(aiTestChannel, () => testAiConnection())
  ipcMain.handle(aiCatalogRefreshChannel, (_event, payload: { provider?: unknown }) => refreshAiModelCatalog(payload ?? {}))
  ipcMain.handle(aiProposalChannel, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 100_000) throw new Error('Invalid AI proposal request')
    return runAiProposal(payload)
  })
  ipcMain.handle(aiCancelChannel, () => cancelAiProposal())
  ipcMain.handle(chatGPTStatusChannel, () => chatGPT?.status())
  ipcMain.handle(chatGPTConnectChannel, () => chatGPT?.connect())
  ipcMain.handle(chatGPTLoginCancelChannel, () => chatGPT?.cancelLogin() ?? { cancelled: false })
  ipcMain.handle(chatGPTDisconnectChannel, () => chatGPT?.disconnect())
  ipcMain.handle(chatGPTConfigureChannel, (_event, payload: { model?: unknown; effort?: unknown }) => chatGPT?.configure(payload ?? {}))
  ipcMain.handle(chatGPTProposalChannel, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 100_000) throw new Error('Invalid ChatGPT proposal request')
    return chatGPT?.runProposal(payload)
  })
  ipcMain.handle(chatGPTCancelChannel, () => chatGPT?.cancel() ?? { cancelled: false })
  ipcMain.handle(workspaceLoadChannel, () => loadWorkspaceManagerState(app.getPath('userData'), workspaceSessionWasUnclean))
  ipcMain.handle(workspaceCreateChannel, (_event, payload: { name?: unknown; workspace?: unknown }) => createWorkspace(app.getPath('userData'), payload?.name, payload?.workspace))
  ipcMain.handle(workspaceRenameChannel, (_event, payload: { workspaceId?: unknown; name?: unknown }) => renameWorkspace(app.getPath('userData'), payload?.workspaceId, payload?.name))
  ipcMain.handle(workspaceDuplicateChannel, (_event, payload: { workspaceId?: unknown; name?: unknown }) => duplicateWorkspace(app.getPath('userData'), payload?.workspaceId, payload?.name))
  ipcMain.handle(workspaceArchiveChannel, (_event, payload: { workspaceId?: unknown }) => archiveWorkspace(app.getPath('userData'), payload?.workspaceId))
  ipcMain.handle(workspaceDeleteChannel, (_event, payload: { workspaceId?: unknown }) => deleteWorkspace(app.getPath('userData'), payload?.workspaceId))
  ipcMain.handle(workspaceOpenChannel, (_event, payload: { workspaceId?: unknown }) => openWorkspace(app.getPath('userData'), payload?.workspaceId))
  ipcMain.handle(workspaceAutosaveChannel, (_event, payload: unknown) => autosaveWorkspaceDraft(app.getPath('userData'), payload))
  ipcMain.handle(workspaceCommitChannel, (_event, payload: unknown) => commitActiveWorkspace(app.getPath('userData'), payload))
  ipcMain.handle(catalogCheckpointLoadChannel, (_event, payload: { key?: unknown }) => loadCatalogCheckpoint(app.getPath('userData'), payload?.key))
  ipcMain.handle(catalogCheckpointSaveChannel, (_event, payload: { key?: unknown; progress?: unknown }) => saveCatalogCheckpoint(app.getPath('userData'), payload?.key, payload?.progress))
  ipcMain.handle(proposalMemoryListChannel, () => listAgentProposalMemory(app.getPath('userData')))
  ipcMain.handle(proposalMemoryRememberChannel, (_event, payload: unknown) => rememberAgentProposal(app.getPath('userData'), payload))
  ipcMain.handle(proposalMemoryStatusChannel, (_event, payload: { graphFingerprint?: unknown; status?: unknown; versionId?: unknown }) => (
    updateAgentProposalMemoryStatus(app.getPath('userData'), payload?.graphFingerprint, payload?.status, payload?.versionId)
  ))
  ipcMain.handle(workspaceRecoveryChannel, (_event, payload: { action?: unknown }) => {
    const state = resolveWorkspaceRecovery(app.getPath('userData'), payload?.action)
    workspaceSessionWasUnclean = false
    return state
  })
  ipcMain.handle(activeAiSourceChannel, () => ({ source: currentActiveAiSource() }))
  ipcMain.handle(activeAiSourceSaveChannel, (_event, payload: { source?: unknown }) => selectActiveAiSource(payload ?? {}))
  ipcMain.handle(diagnosticsRecordChannel, (_event, payload: unknown) => recordDiagnosticEvent(app.getPath('userData'), payload))
  ipcMain.handle(diagnosticsExportChannel, () => exportDiagnosticBundle(app.getPath('userData')))
  ipcMain.handle(diagnosticsSettingsChannel, () => loadDiagnosticSettings(app.getPath('userData')))
  ipcMain.handle(diagnosticsSettingsSaveChannel, (_event, payload: unknown) => saveDiagnosticSettings(app.getPath('userData'), payload))
  ipcMain.handle(diagnosticsOpenChannel, () => {
    const path = ensureDiagnosticLog(app.getPath('userData'))
    shell.showItemInFolder(path)
    return { opened: true, path }
  })
  ipcMain.handle(incidentsListChannel, () => listIncidentEvents(app.getPath('userData')))
  ipcMain.handle(incidentsRecordChannel, (_event, payload: unknown) => recordIncidentEvent(app.getPath('userData'), payload))
  ipcMain.handle(incidentsClearChannel, () => clearIncidentEvents(app.getPath('userData')))
  ipcMain.handle(applicationRestartChannel, () => {
    setTimeout(() => { app.relaunch(); app.quit() }, 80)
    return { restarting: true }
  })
  ipcMain.handle(appUpdateStatusChannel, () => appUpdates?.getStatus())
  ipcMain.handle(appUpdateSetChannel, (_event, payload: { channel?: unknown }) => {
    if (payload?.channel !== 'stable' && payload?.channel !== 'main') throw new Error('Invalid application update channel')
    saveAppSetting(app.getPath('userData'), 'app-update-channel', payload.channel)
    saveSetupChannel(app.getPath('userData'), payload.channel)
    return appUpdates?.setChannel(payload.channel)
  })
  ipcMain.handle(appUpdateCheckChannel, () => appUpdates?.check())
  ipcMain.handle(appUpdateDownloadChannel, () => appUpdates?.download())
  ipcMain.handle(appUpdateOpenSetupChannel, () => {
    const channel = appUpdates?.getStatus().channel ?? 'stable'
    saveAppSetting(app.getPath('userData'), 'app-update-channel', channel)
    return openSetupUpdater(app.getPath('userData'), channel)
  })
  ipcMain.handle(appUpdateInstallChannel, async (event) => {
    const status = appUpdates?.getStatus()
    if (!status?.canInstall) throw new Error('No verified update is ready to install')
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'question' as const,
      title: 'Install verified SAM LAB update',
      message: `Restart and install SAM LAB ${status.availableVersion ?? 'update'}?`,
      detail: 'The application will close. The operating system and electron-updater will enforce the downloaded application signature before replacement.',
      buttons: ['Restart & install', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const confirmation = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (confirmation.response !== 0) return status
    return appUpdates?.install()
  })
  createMainWindow()
  void appUpdates.initialize()
  app.on('activate', () => {
    focusMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  chatGPT?.stop()
  markWorkspaceSessionClean(app.getPath('userData'))
  closeWorkspaceDatabase()
  void closeDataHubMcp()
})
