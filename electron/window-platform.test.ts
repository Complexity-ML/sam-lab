import { describe, expect, it } from 'vitest'
import { desktopWindowFrame } from './window-platform.js'

describe('desktop window chrome', () => {
  it('keeps the native Windows frame outside the application header', () => {
    expect(desktopWindowFrame('win32')).toEqual({
      titleBarStyle: 'default',
      autoHideMenuBar: true,
    })
  })

  it('preserves native platform conventions elsewhere', () => {
    expect(desktopWindowFrame('darwin')).toMatchObject({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 26 } })
    expect(desktopWindowFrame('linux')).toEqual({ titleBarStyle: 'default', autoHideMenuBar: true })
  })
})
