import { createBrandHeader } from './components/brand-header.js'
import { createHeroSection } from './components/hero-section.js'
import { createInstallFooter } from './components/install-footer.js'
import { createProgressCard } from './components/progress-card.js'
import { createChannelSelector } from './components/channel-selector.js'

const root = document.querySelector('#setup-app')
const hero = createHeroSection()
const status = createProgressCard()
const footer = createInstallFooter()
const channel = createChannelSelector()
let channelInitialized = false

root.append(createBrandHeader(), hero.element, channel.element, status.element, footer.element)

function setInstalling(installing) {
  footer.button.disabled = installing
  channel.setDisabled(installing)
  footer.button.textContent = installing ? 'Installing...' : 'Install latest'
  root.classList.toggle('is-installing', installing)
}

function showPreview() {
  status.setVersion('Latest release')
  status.update({ stage: 'Build', message: 'Building the native SAM LAB Electron application...', percent: 52 })
  status.appendLog('5% Release', 'Checking the latest SAM LAB release...')
  status.appendLog('12% Source', 'Downloading the latest release source...')
  status.appendLog('36% Dependencies', 'Installing locked JavaScript dependencies...')
  status.appendLog('52% Build', 'Building the native SAM LAB Electron application...')
  setInstalling(true)
}

async function startTauriIntegration() {
  const tauri = window.__TAURI__
  if (!tauri?.core?.invoke || !tauri?.event?.listen) {
    showPreview()
    return
  }

  const invoke = tauri.core.invoke
  const listen = tauri.event.listen

  async function refresh() {
    try {
      const state = await invoke('setup_status', { channel: channelInitialized ? channel.value : null })
      channel.setValue(state.channel)
      channelInitialized = true
      hero.setChannel(state.channel)
      status.setVersion(state.latestTag ? `Latest ${state.latestTag}` : `Installed ${state.installedTag || 'none'}`)
      footer.button.disabled = state.installing
      footer.button.textContent = state.installing
        ? 'Installing...'
        : state.installedTag === state.latestTag
          ? 'Reinstall latest'
          : state.installedTag
            ? 'Update SAM LAB'
            : 'Install latest'
    } catch (error) {
      status.setVersion('GitHub check unavailable')
      status.setMessage(String(error))
    }
  }

  channel.onChange(async (value) => {
    hero.setChannel(value)
    await refresh()
  })

  await listen('setup-progress', ({ payload }) => {
    const failed = payload.stage === 'Failed'
    setInstalling(!failed)
    footer.button.textContent = failed ? 'Retry installation' : 'Installing...'
    status.update(payload)
    status.appendLog(`${payload.percent}% ${payload.stage}`, payload.message)
  })

  footer.button.addEventListener('click', async () => {
    setInstalling(true)
    try {
      const result = await invoke('install_latest', { channel: channel.value })
      if (result.setupRelaunched) {
        status.setVersion(result.tag)
        status.update({
          stage: 'Updating Setup',
          message: 'The verified latest Setup is taking over this installation.',
        })
        status.appendLog('Relaunch', 'Closing this Setup and continuing in the newly verified helper.')
        return
      }
      status.setVersion(result.tag)
      status.update({
        stage: 'Installed',
        message: 'SAM LAB is installed and launching. Future updates are available from Settings.',
        percent: 100,
      })
      footer.button.textContent = 'Installed'
    } catch (error) {
      const detail = String(error)
      if (detail.includes('already installing')) {
        status.update({
          stage: 'Installing',
          message: 'The active installation is still running in this Setup window.',
        })
      } else {
        status.update({ stage: 'Failed', message: detail })
        setInstalling(false)
        footer.button.textContent = 'Retry installation'
      }
    }
  })

  await refresh()
}

void startTauriIntegration()
