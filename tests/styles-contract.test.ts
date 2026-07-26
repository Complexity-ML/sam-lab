import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(fileURLToPath(new URL('../src/styles/index.scss', import.meta.url)), 'utf8')

function declarations(selector: string): Map<string, string> {
  const signature = `${selector} {`
  const start = stylesheet.indexOf(signature)
  expect(start, `Missing SCSS rule for ${selector}`).toBeGreaterThanOrEqual(0)
  const bodyStart = start + signature.length
  const bodyEnd = stylesheet.indexOf('}', bodyStart)
  expect(bodyEnd, `Unclosed SCSS rule for ${selector}`).toBeGreaterThan(bodyStart)

  return new Map(stylesheet.slice(bodyStart, bodyEnd)
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(':')
      return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]
    }))
}

function pixels(value: string | undefined): number {
  expect(value).toMatch(/^\d+(?:\.\d+)?px$/)
  return Number.parseFloat(value!)
}

describe('visual SCSS contracts', () => {
  it('shares one bounded themed scroll area and panel shell across every sidebar', () => {
    const scroll = declarations('.panel-scroll-area')

    expect(scroll.get('overflow-y')).toBe('auto')
    expect(scroll.get('overflow-x')).toBe('hidden')
    expect(scroll.get('overscroll-behavior')).toBe('contain')
    expect(scroll.get('scrollbar-gutter')).toBe('stable')
    expect(scroll.get('scrollbar-width')).toBe('thin')
    expect(scroll.get('min-height')).toBe('0')
    expect(scroll.get('flex')).toBe('1')
    expect(stylesheet).toContain('.library-panel, .left-operations-panel, .inspector-panel { display: flex; overflow: hidden; height: 100%; flex-direction: column; }')
  })

  it('keeps a fixed prompt dock while the form grows upward and scrolls independently of its actions', () => {
    const dock = declarations('.data-agent-prompt-dock')
    const prompt = declarations('.data-agent-prompt')
    const textarea = declarations('.data-agent-prompt textarea')
    const actions = declarations('.data-agent-actions')

    const dockHeight = pixels(dock.get('height'))
    expect(dock.get('position')).toBe('relative')
    expect(prompt.get('position')).toBe('absolute')
    expect(prompt.get('bottom')).toBe('0')
    expect(pixels(prompt.get('max-height'))).toBeGreaterThan(dockHeight)

    expect(textarea.get('resize')).toBe('none')
    expect(textarea.get('overflow-x')).toBe('hidden')
    expect(textarea.get('scrollbar-gutter')).toBe('stable')
    expect(pixels(textarea.get('max-height'))).toBeGreaterThan(pixels(textarea.get('min-height')))

    expect(prompt.get('grid-template-columns')).toMatch(/^minmax\(0, 1fr\) \d+px$/)
    expect(actions.get('grid-column')).toBe('2')
    expect(actions.get('grid-row')).toBe('1 / span 2')
  })

  it('places approved above its handle and quarantine below its handle', () => {
    const approvedHandle = declarations('.split-approved').get('top')
    const quarantineHandle = declarations('.split-quarantine').get('top')
    const approvedLabel = declarations('.approved-label').get('top')
    const quarantineLabel = declarations('.quarantine-label').get('top')

    expect(approvedHandle).toMatch(/^\d+% !important$/)
    expect(approvedLabel).toMatch(/^\d+%$/)
    expect(Number.parseFloat(approvedLabel!)).toBeLessThan(Number.parseFloat(approvedHandle!))

    const quarantinePercent = Number.parseFloat(quarantineHandle!)
    expect(quarantineLabel).toBe(`calc(${quarantinePercent}% + 9px)`)
  })

  it('gives all eight card kinds a distinct dark treatment', () => {
    const kinds = ['source', 'analysis', 'split', 'decision', 'transform', 'review', 'validation', 'output']
    const darkTreatments = kinds.map((kind) => {
      const dark = declarations(`:root[data-theme='dark'] .pipeline-card.card-${kind}`)
      const base = declarations(`.pipeline-card.card-${kind}`)
      expect(dark.get('background')).toContain('linear-gradient(')
      expect(dark.get('background')).toContain('var(--panel)')
      expect(dark.get('box-shadow')).toContain('inset')
      expect(base.get('border-left-color')).toBe(`var(--${kind}-strong)`)
      return `${dark.get('background')}|${dark.get('box-shadow')}|${base.get('border-left-color')}`
    })

    expect(new Set(darkTreatments).size).toBe(kinds.length)
  })

  it('keeps the full modal close control outside Electron drag regions', () => {
    const close = declarations('.settings-close')
    expect(close.get('position')).toBe('relative')
    expect(close.get('z-index')).toBe('2')
    expect(close.get('width')).toBe('34px')
    expect(close.get('min-width')).toBe('34px')
    expect(close.get('height')).toBe('34px')
    expect(close.get('min-height')).toBe('34px')
    expect(close.get('pointer-events')).toBe('auto')
    expect(close.get('-webkit-app-region')).toBe('no-drag')
  })

  it('keeps every canvas sticker equal-sized and compacts each side without holes', () => {
    const stack = declarations('.canvas-sticker-stack')
    const stickers = declarations('.inspector-open, .library-open, .actions-open, .logs-open, .risks-open, .reports-open, .results-open')

    expect(stack.get('display')).toBe('grid')
    expect(stack.get('grid-auto-flow')).toBe('row')
    expect(stack.get('grid-auto-rows')).toBe('34px')
    expect(stack.get('gap')).toBe('8px')
    expect(stickers.get('width')).toBe('108px')
    expect(stickers.get('height')).toBe('34px')
    expect(stickers.get('min-height')).toBe('34px')
  })

  it('keeps compact profile evidence on one bounded line', () => {
    const metrics = declarations('.profile-summary span')
    const evidence = declarations('.profile-summary > small')

    expect(metrics.get('overflow')).toBe('hidden')
    expect(metrics.get('text-overflow')).toBe('ellipsis')
    expect(metrics.get('white-space')).toBe('nowrap')
    expect(evidence.get('grid-column')).toBe('1 / -1')
    expect(evidence.get('overflow')).toBe('hidden')
    expect(evidence.get('text-overflow')).toBe('ellipsis')
    expect(evidence.get('white-space')).toBe('nowrap')
  })
})
