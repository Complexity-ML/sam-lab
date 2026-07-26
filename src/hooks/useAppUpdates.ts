import { useCallback, useEffect, useState } from 'react'
import type { AppUpdateChannel, AppUpdateStatus } from '../domain/updates'
import { unavailableAppUpdateStatus } from '../domain/updates'
import { notifyError } from '../domain/toasts'

export function useAppUpdates(reportActivity: (message: string) => void) {
  const [status, setStatus] = useState<AppUpdateStatus>(unavailableAppUpdateStatus)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!window.dataLab?.getAppUpdateStatus) return
    void window.dataLab.getAppUpdateStatus().then(setStatus).catch((error) => notifyError(error, 'Unable to load update status'))
    return window.dataLab.onAppUpdateStatusChanged?.(setStatus)
  }, [])

  const perform = useCallback(async (action: () => Promise<AppUpdateStatus>, activity: string) => {
    setBusy(true)
    try {
      const next = await action()
      setStatus(next)
      reportActivity(activity)
      return next
    } catch (error) {
      notifyError(error, 'Application update failed')
      throw error
    } finally {
      setBusy(false)
    }
  }, [reportActivity])

  const setChannel = (channel: AppUpdateChannel) => {
    if (!window.dataLab?.setAppUpdateChannel) return Promise.reject(new Error('Updates require the Electron application'))
    return perform(() => window.dataLab!.setAppUpdateChannel(channel), `${channel === 'stable' ? 'Stable' : 'Main preview'} update channel selected`)
  }

  const check = () => {
    if (!window.dataLab?.checkForAppUpdate) return Promise.reject(new Error('Updates require the Electron application'))
    return perform(() => window.dataLab!.checkForAppUpdate(), 'Update check completed')
  }

  const download = () => {
    if (!window.dataLab?.downloadAppUpdate) return Promise.reject(new Error('Updates require the Electron application'))
    return perform(() => window.dataLab!.downloadAppUpdate(), 'Signed update download started')
  }

  const install = () => {
    if (!window.dataLab?.installAppUpdate) return Promise.reject(new Error('Updates require the Electron application'))
    return perform(() => window.dataLab!.installAppUpdate(), 'Update installation requested')
  }

  const openSetup = async () => {
    if (!window.dataLab?.openAppSetupUpdater) throw new Error('SAM LAB Setup requires the Electron application')
    setBusy(true)
    try {
      const result = await window.dataLab.openAppSetupUpdater()
      reportActivity(`SAM LAB Setup opened on the ${result.channel} channel`)
      return result
    } catch (error) {
      notifyError(error, 'Unable to open SAM LAB Setup')
      throw error
    } finally {
      setBusy(false)
    }
  }

  return { busy, check, download, install, openSetup, setChannel, status }
}
