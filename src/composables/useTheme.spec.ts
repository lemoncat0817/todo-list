import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useTheme, applyTheme } from './useTheme'

describe('useTheme & applyTheme', () => {
  let mediaQueryListeners: ((e: any) => void)[] = []
  let systemPrefersDark = false

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    mediaQueryListeners = []
    systemPrefersDark = false

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? systemPrefersDark : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event: string, handler: (e: any) => void) => {
        if (event === 'change') mediaQueryListeners.push(handler)
      }),
      removeEventListener: vi.fn((event: string, handler: (e: any) => void) => {
        if (event === 'change') {
          mediaQueryListeners = mediaQueryListeners.filter((h) => h !== handler)
        }
      }),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  function mountTestComponent() {
    let result!: ReturnType<typeof useTheme>
    const Comp = defineComponent({
      setup() {
        result = useTheme()
        return () => h('div')
      },
    })
    const wrapper = mount(Comp)
    return { wrapper, theme: result }
  }

  it('applyTheme: dark 時加上 .dark，light 時移除 .dark', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applyTheme: system 且系統為深色時加上 .dark，系統為淺色時移除 .dark', () => {
    systemPrefersDark = true
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    systemPrefersDark = false
    applyTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('預設讀取 localStorage，若無紀錄則預設為 system', () => {
    const { theme } = mountTestComponent()
    expect(theme.preference.value).toBe('system')
  })

  it('若 localStorage 有有效紀錄（light 或 dark），初始化時讀取該值', () => {
    localStorage.setItem('todoTask:theme', 'dark')
    const { theme } = mountTestComponent()
    expect(theme.preference.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('若 localStorage 拋出錯誤（如 Safari 封鎖），安全 fallback 為 system', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('Access denied')
    })
    const { theme } = mountTestComponent()
    expect(theme.preference.value).toBe('system')
  })

  it('cycle() 會依序在 system -> light -> dark -> system 循環切換並更新 localStorage', async () => {
    const { theme } = mountTestComponent()
    expect(theme.preference.value).toBe('system')

    // 切到 light
    theme.cycle()
    await nextTick()
    expect(theme.preference.value).toBe('light')
    expect(localStorage.getItem('todoTask:theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // 切到 dark
    theme.cycle()
    await nextTick()
    expect(theme.preference.value).toBe('dark')
    expect(localStorage.getItem('todoTask:theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // 切回 system
    theme.cycle()
    await nextTick()
    expect(theme.preference.value).toBe('system')
    expect(localStorage.getItem('todoTask:theme')).toBeNull()
  })

  it('localStorage.setItem 拋出錯誤時不中斷主題套用', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('Quota exceeded')
    })
    const { theme } = mountTestComponent()
    theme.cycle() // to light
    await nextTick()
    expect(theme.preference.value).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('當處於 system 偏好時，系統主題變化會觸發 applyTheme', async () => {
    mountTestComponent()
    expect(mediaQueryListeners.length).toBeGreaterThan(0)

    // 模擬系統變成深色
    systemPrefersDark = true
    for (const listener of mediaQueryListeners) {
      listener({ matches: true })
    }
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('組件卸載時會移除 matchMedia 事件監聽器', () => {
    const { wrapper } = mountTestComponent()
    expect(mediaQueryListeners.length).toBe(1)

    wrapper.unmount()
    expect(mediaQueryListeners.length).toBe(0)
  })
})
