import type { Dispatch, SetStateAction } from 'react'
import type { IncidentEvent } from '../domain/incidents'
import { notifyError, notifyToast } from '../domain/toasts'

export function useDiagnosticsActions(setIncidentEvents: Dispatch<SetStateAction<IncidentEvent[]>>) {
  const exportDiagnostics = async () => {
    if (!window.dataLab) { notifyError('Diagnostics require the Electron application'); return }
    try {
      const bundle = await window.dataLab.exportDiagnostics()
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `sam-lab-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      notifyToast(`Exported ${bundle.events.length} sanitized local events`, 'success', 'Diagnostics ready')
    } catch (error) { notifyError(error, 'Unable to export diagnostics') }
  }

  const openLogs = async () => {
    if (!window.dataLab) { notifyError('Diagnostics require the Electron application'); return }
    try { await window.dataLab.openDiagnosticLogs() } catch (error) { notifyError(error, 'Unable to open diagnostic logs') }
  }

  const loadBundle = async () => {
    if (!window.dataLab) throw new Error('Diagnostics require the Electron application')
    return window.dataLab.exportDiagnostics()
  }

  const clearIncidentReports = async () => {
    if (!window.dataLab?.clearIncidentEvents) throw new Error('Incident cleanup requires the Electron application')
    const result = await window.dataLab.clearIncidentEvents()
    setIncidentEvents([])
    notifyToast(`${result.deleted} local incident event${result.deleted === 1 ? '' : 's'} removed from this workspace.`, 'success', 'Reports cleared')
    return result
  }

  return { clearIncidentReports, exportDiagnostics, loadBundle, openLogs }
}
