import { createElement } from './dom.js'

export function createHeroSection() {
  const channel = createElement('strong', { className: 'setup-channel', text: 'Building Release' })
  const element = createElement('section', { className: 'setup-hero' }, [
    createElement('div', { className: 'setup-hero__meta' }, [
      createElement('span', { className: 'eyebrow', text: 'SOURCE-FIRST DESKTOP' }),
      channel,
    ]),
    createElement('h2', { text: 'Build and install SAM LAB locally.' }),
    createElement('p', {
      text: 'Setup fetches the requested GitHub source, reuses a verified managed Node.js runtime, and builds the native Electron application on this computer.',
    }),
  ])
  return {
    element,
    setChannel(value) { channel.textContent = value === 'main' ? 'Building Main' : 'Building Release' },
  }
}
