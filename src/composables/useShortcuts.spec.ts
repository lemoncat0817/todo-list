import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useShortcuts, type ShortcutHandlers } from './useShortcuts'

describe('useShortcuts', () => {
  let handlers: ShortcutHandlers

  beforeEach(() => {
    handlers = {
      undo: vi.fn(),
      focusSearch: vi.fn(),
      focusNew: vi.fn(),
      palette: vi.fn(),
      help: vi.fn(),
      escape: vi.fn(),
    }
  })

  function mountTestComponent(overrideHandlers?: Partial<ShortcutHandlers>) {
    const activeHandlers = { ...handlers, ...overrideHandlers }
    const Comp = defineComponent({
      setup() {
        useShortcuts(activeHandlers)
        return () => h('div')
      },
    })
    return mount(Comp)
  }

  function dispatchKey(key: string, init: Partial<KeyboardEventInit> = {}, target: EventTarget = window) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    target.dispatchEvent(event)
    return event
  }

  it('按「/」觸發 focusSearch', () => {
    mountTestComponent()
    const event = dispatchKey('/')
    expect(handlers.focusSearch).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('按「n」或「N」觸發 focusNew', () => {
    mountTestComponent()
    dispatchKey('n')
    dispatchKey('N')
    expect(handlers.focusNew).toHaveBeenCalledTimes(2)
  })

  it('按「?」觸發 help', () => {
    mountTestComponent()
    const event = dispatchKey('?')
    expect(handlers.help).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('按 Ctrl+Z 或 Cmd+Z 觸發 undo，但 Shift+Ctrl+Z（Redo）不觸發', () => {
    mountTestComponent()
    // Ctrl+Z
    dispatchKey('z', { ctrlKey: true })
    expect(handlers.undo).toHaveBeenCalledTimes(1)

    // Cmd+Z (Mac)
    dispatchKey('Z', { metaKey: true })
    expect(handlers.undo).toHaveBeenCalledTimes(2)

    // Redo (Shift+Ctrl+Z) 應被略過
    dispatchKey('z', { ctrlKey: true, shiftKey: true })
    expect(handlers.undo).toHaveBeenCalledTimes(2)
  })

  it('按 Ctrl+K 或 Cmd+K 觸發 palette', () => {
    mountTestComponent()
    dispatchKey('k', { ctrlKey: true })
    dispatchKey('k', { metaKey: true })
    expect(handlers.palette).toHaveBeenCalledTimes(2)
  })

  it('按 Escape 觸發 escape', () => {
    mountTestComponent()
    dispatchKey('Escape')
    expect(handlers.escape).toHaveBeenCalledTimes(1)
  })

  it('在 input 或 textarea 打字時，一般快捷鍵（/、n、?）不被攔截', () => {
    mountTestComponent()

    const input = document.createElement('input')
    document.body.appendChild(input)

    const eventSlash = dispatchKey('/', {}, input)
    dispatchKey('n', {}, input)
    dispatchKey('?', {}, input)

    expect(handlers.focusSearch).not.toHaveBeenCalled()
    expect(handlers.focusNew).not.toHaveBeenCalled()
    expect(handlers.help).not.toHaveBeenCalled()
    expect(eventSlash.defaultPrevented).toBe(false)

    document.body.removeChild(input)
  })

  it('在輸入框中，Escape 與 Ctrl+K 仍可正常觸發以供跳出或切換', () => {
    mountTestComponent()

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    dispatchKey('Escape', {}, textarea)
    expect(handlers.escape).toHaveBeenCalledTimes(1)

    dispatchKey('k', { ctrlKey: true }, textarea)
    expect(handlers.palette).toHaveBeenCalledTimes(1)

    document.body.removeChild(textarea)
  })

  it('組件卸載後移除全域事件監聽', () => {
    const wrapper = mountTestComponent()
    dispatchKey('/')
    expect(handlers.focusSearch).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    dispatchKey('/')
    // 卸載後不應再觸發
    expect(handlers.focusSearch).toHaveBeenCalledTimes(1)
  })
})
