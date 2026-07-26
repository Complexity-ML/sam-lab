import type { BrowserWindowConstructorOptions } from 'electron'

export function desktopWindowFrame(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 26 } }
  return { titleBarStyle: 'default', autoHideMenuBar: true }
}
