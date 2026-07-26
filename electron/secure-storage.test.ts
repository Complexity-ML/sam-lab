import { describe, expect, it } from 'vitest'
import { secureStorageCapability } from './secure-storage.js'

describe('non-invasive secure storage capability', () => {
  it('advertises built-in desktop credential stores without touching Electron safeStorage', () => {
    expect(secureStorageCapability('darwin')).toBe(true)
    expect(secureStorageCapability('win32')).toBe(true)
    expect(secureStorageCapability('linux')).toBe(false)
  })
})
