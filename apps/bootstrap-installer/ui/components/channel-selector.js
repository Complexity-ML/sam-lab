import { createElement } from './dom.js'

export function createChannelSelector() {
  let value = 'stable'
  let changeHandler = () => undefined
  const stable = createElement('button', { text: 'Stable', attributes: { type: 'button', 'aria-pressed': 'true' } })
  const main = createElement('button', { text: 'Main', attributes: { type: 'button', 'aria-pressed': 'false' } })
  const description = createElement('small', { text: 'Latest published SAM LAB release · recommended' })
  const element = createElement('section', { className: 'channel-selector', attributes: { 'aria-label': 'SAM LAB source channel' } }, [
    createElement('div', {}, [stable, main]),
    description,
  ])

  function setValue(next, notify = false) {
    value = next === 'main' ? 'main' : 'stable'
    stable.setAttribute('aria-pressed', String(value === 'stable'))
    main.setAttribute('aria-pressed', String(value === 'main'))
    description.textContent = value === 'main'
      ? 'Newest commit from main · preview'
      : 'Latest published SAM LAB release · recommended'
    if (notify) changeHandler(value)
  }

  stable.addEventListener('click', () => setValue('stable', true))
  main.addEventListener('click', () => setValue('main', true))

  return {
    element,
    get value() { return value },
    onChange(handler) { changeHandler = handler },
    setDisabled(disabled) {
      stable.disabled = disabled
      main.disabled = disabled
    },
    setValue,
  }
}
