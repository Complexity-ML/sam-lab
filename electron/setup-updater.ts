import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import type { AppUpdateChannel } from './update-policy.js'

export function setupHelperPath(userDataDirectory: string, platform: NodeJS.Platform = process.platform) {
  const platformPath = platform === 'win32' ? win32 : posix
  return platformPath.join(
    userDataDirectory,
    'installer',
    platform === 'win32' ? 'sam-lab-setup.exe' : 'sam-lab-setup',
  )
}

export function readSetupChannel(userDataDirectory: string): AppUpdateChannel | undefined {
  try {
    const value = readFileSync(join(userDataDirectory, 'installer', 'channel'), 'utf8').trim()
    return value === 'main' ? 'main' : value === 'stable' ? 'stable' : undefined
  } catch {
    return undefined
  }
}

export function saveSetupChannel(userDataDirectory: string, channel: AppUpdateChannel) {
  const path = join(userDataDirectory, 'installer', 'channel')
  mkdirSync(join(userDataDirectory, 'installer'), { recursive: true })
  writeFileSync(path, channel, 'utf8')
  return path
}

export function openSetupUpdater(userDataDirectory: string, channel: AppUpdateChannel) {
  const executable = setupHelperPath(userDataDirectory)
  if (!existsSync(executable)) {
    throw new Error('SAM LAB Setup is not installed yet. Download and run the current Setup installer first.')
  }
  saveSetupChannel(userDataDirectory, channel)
  const child = spawn(executable, ['--channel', channel], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { opened: true as const, channel, path: executable }
}
