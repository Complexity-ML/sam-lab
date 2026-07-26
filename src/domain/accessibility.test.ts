import { describe, expect, it } from 'vitest'

function luminance(hex: string) {
  const channels = hex.match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? []
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

describe('accessible semantic palette', () => {
  it.each([
    ['light body text', '172033', 'f8fafc'],
    ['light secondary text', '607084', 'f1f5f9'],
    ['light accent button', 'ffffff', '5b5de6'],
    ['dark body text', 'e7edf6', '1c273a'],
    ['dark secondary text', '9aa9bd', '1c273a'],
    ['dark faint labels', '8190a5', '1c273a'],
    ['diagnostic title', '14532d', 'dcfce7'],
    ['diagnostic description', '166534', 'dcfce7'],
  ])('%s meets WCAG AA for normal text', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})
