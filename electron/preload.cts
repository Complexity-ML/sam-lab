import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('dataLab', {
  runtime: 'electron',
  platform: process.platform,
  getDataHubStatus: () => ipcRenderer.invoke(statusChannel),
  loadDatasetContext: (urn: string) => ipcRenderer.invoke(datasetChannel, { urn }),
  getDataHubMcpStatus: () => ipcRenderer.invoke(mcpStatusChannel),
  connectDataHubMcp: () => ipcRenderer.invoke(mcpConnectChannel),
  saveDataHubMcpSettings: (payload: { transport: 'http' | 'stdio'; url: string; catalogReadRoute?: 'auto' | 'gms' | 'mcp'; token?: string; clearToken?: boolean; writebackEnabled?: boolean }) => ipcRenderer.invoke(mcpSettingsSaveChannel, payload),
  auditDataHubWithMcp: (urn: string, force = false) => ipcRenderer.invoke(mcpAuditChannel, { urn, force }),
  searchDataHubAssets: (query: string) => ipcRenderer.invoke(mcpSearchChannel, { query }),
  inspectDataHubAsset: (urn: string, force = false, mode: 'summary' | 'deep' = 'deep') => ipcRenderer.invoke(mcpInspectChannel, { urn, force, mode }),
  invalidateDataHubContext: (urn?: string) => ipcRenderer.invoke(mcpInvalidateChannel, { urn }),
  writeDataHubDecision: (payload: { revisionId: string; title: string; rationale: string; author: string; relatedAssets: string[] }) => ipcRenderer.invoke(mcpWritebackChannel, payload),
  listCatalogConnectors: () => ipcRenderer.invoke(catalogConnectorsListChannel),
  saveCatalogConnector: (payload: unknown) => ipcRenderer.invoke(catalogConnectorSaveChannel, payload),
  deleteCatalogConnector: (id: string) => ipcRenderer.invoke(catalogConnectorDeleteChannel, { id }),
  testCatalogConnector: (id: string) => ipcRenderer.invoke(catalogConnectorTestChannel, { id }),
  searchCatalogAssets: (query: string) => ipcRenderer.invoke(catalogSearchChannel, { query }),
  inspectCatalogAsset: (connectorId: string, assetRef: string, force = false, mode: 'summary' | 'deep' = 'deep') => ipcRenderer.invoke(catalogInspectChannel, { connectorId, assetRef, force, mode }),
  notifyHumanReview: (payload: { cardLabel: string; reason: string; versionId?: string; remind?: boolean }) => ipcRenderer.invoke(humanReviewNotificationChannel, payload),
  getAiStatus: () => ipcRenderer.invoke(aiStatusChannel),
  saveAiSettings: (payload: unknown) => ipcRenderer.invoke(aiSaveChannel, payload),
  testAiConnection: () => ipcRenderer.invoke(aiTestChannel),
  refreshAiModelCatalog: (provider: 'openai' | 'anthropic' | 'moonshot') => ipcRenderer.invoke(aiCatalogRefreshChannel, { provider }),
  runAiProposal: (payload: unknown) => ipcRenderer.invoke(aiProposalChannel, payload),
  cancelAiProposal: () => ipcRenderer.invoke(aiCancelChannel),
  getChatGPTStatus: () => ipcRenderer.invoke(chatGPTStatusChannel),
  connectChatGPT: () => ipcRenderer.invoke(chatGPTConnectChannel),
  cancelChatGPTLogin: () => ipcRenderer.invoke(chatGPTLoginCancelChannel),
  disconnectChatGPT: () => ipcRenderer.invoke(chatGPTDisconnectChannel),
  configureChatGPT: (payload: { model: string; effort: string }) => ipcRenderer.invoke(chatGPTConfigureChannel, payload),
  runChatGPTProposal: (payload: unknown) => ipcRenderer.invoke(chatGPTProposalChannel, payload),
  cancelChatGPTProposal: () => ipcRenderer.invoke(chatGPTCancelChannel),
  loadWorkspaceState: () => ipcRenderer.invoke(workspaceLoadChannel),
  createWorkspace: (name: string, workspace: unknown) => ipcRenderer.invoke(workspaceCreateChannel, { name, workspace }),
  renameWorkspace: (workspaceId: string, name: string) => ipcRenderer.invoke(workspaceRenameChannel, { workspaceId, name }),
  duplicateWorkspace: (workspaceId: string, name?: string) => ipcRenderer.invoke(workspaceDuplicateChannel, { workspaceId, name }),
  archiveWorkspace: (workspaceId: string) => ipcRenderer.invoke(workspaceArchiveChannel, { workspaceId }),
  deleteWorkspace: (workspaceId: string) => ipcRenderer.invoke(workspaceDeleteChannel, { workspaceId }),
  openWorkspace: (workspaceId: string) => ipcRenderer.invoke(workspaceOpenChannel, { workspaceId }),
  autosaveWorkspace: (workspace: unknown) => ipcRenderer.invoke(workspaceAutosaveChannel, workspace),
  commitWorkspace: (workspace: unknown) => ipcRenderer.invoke(workspaceCommitChannel, workspace),
  resolveWorkspaceRecovery: (action: 'recover' | 'discard') => ipcRenderer.invoke(workspaceRecoveryChannel, { action }),
  loadCatalogCheckpoint: (key: string) => ipcRenderer.invoke(catalogCheckpointLoadChannel, { key }),
  saveCatalogCheckpoint: (key: string, progress: unknown) => ipcRenderer.invoke(catalogCheckpointSaveChannel, { key, progress }),
  listAgentProposalMemory: () => ipcRenderer.invoke(proposalMemoryListChannel),
  rememberAgentProposal: (proposal: unknown) => ipcRenderer.invoke(proposalMemoryRememberChannel, proposal),
  updateAgentProposalMemoryStatus: (graphFingerprint: string, status: string, versionId?: string) => ipcRenderer.invoke(proposalMemoryStatusChannel, { graphFingerprint, status, versionId }),
  getActiveAiSource: () => ipcRenderer.invoke(activeAiSourceChannel),
  setActiveAiSource: (source: 'chatgpt' | 'openai' | 'anthropic' | 'moonshot') => ipcRenderer.invoke(activeAiSourceSaveChannel, { source }),
  recordDiagnostic: (event: unknown) => ipcRenderer.invoke(diagnosticsRecordChannel, event),
  exportDiagnostics: () => ipcRenderer.invoke(diagnosticsExportChannel),
  openDiagnosticLogs: () => ipcRenderer.invoke(diagnosticsOpenChannel),
  getDiagnosticSettings: () => ipcRenderer.invoke(diagnosticsSettingsChannel),
  saveDiagnosticSettings: (settings: unknown) => ipcRenderer.invoke(diagnosticsSettingsSaveChannel, settings),
  listIncidentEvents: () => ipcRenderer.invoke(incidentsListChannel),
  recordIncidentEvent: (event: unknown) => ipcRenderer.invoke(incidentsRecordChannel, event),
  clearIncidentEvents: () => ipcRenderer.invoke(incidentsClearChannel),
  restartApplication: () => ipcRenderer.invoke(applicationRestartChannel),
  getAppUpdateStatus: () => ipcRenderer.invoke(appUpdateStatusChannel),
  setAppUpdateChannel: (channel: 'stable' | 'main') => ipcRenderer.invoke(appUpdateSetChannel, { channel }),
  checkForAppUpdate: () => ipcRenderer.invoke(appUpdateCheckChannel),
  downloadAppUpdate: () => ipcRenderer.invoke(appUpdateDownloadChannel),
  installAppUpdate: () => ipcRenderer.invoke(appUpdateInstallChannel),
  openAppSetupUpdater: () => ipcRenderer.invoke(appUpdateOpenSetupChannel),
  onAppUpdateStatusChanged: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on(appUpdateStatusChangedChannel, listener)
    return () => ipcRenderer.removeListener(appUpdateStatusChangedChannel, listener)
  },
  onHumanReviewOpened: (callback: (payload: { versionId?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { versionId?: string } = {}) => callback(payload)
    ipcRenderer.on(humanReviewOpenedChannel, listener)
    return () => ipcRenderer.removeListener(humanReviewOpenedChannel, listener)
  },
  getWindowState: () => ipcRenderer.invoke(windowStateChannel),
  onWindowStateChanged: (callback: (state: { fullscreen: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { fullscreen: boolean }) => callback(state)
    ipcRenderer.on(windowStateChangedChannel, listener)
    return () => ipcRenderer.removeListener(windowStateChangedChannel, listener)
  },
})
