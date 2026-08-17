import { onMounted, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 主題切換：淺色 / 深色 / 跟隨系統。
 *
 * 三態而非兩態是刻意的：純粹的開／關會讓「跟隨系統」變成不可能，
 * 而那正是多數人真正想要的預設。
 */
export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'todoTask:theme'

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    // Safari 停用 cookie 時存取 localStorage 會直接拋錯
    return 'system'
  }
}

/** 把偏好套用到 documentElement。淺色/深色都由 .dark class 決定。 */
export function applyTheme(preference: ThemePreference): void {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = preference === 'dark' || (preference === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}

export function useTheme() {
  const preference = ref<ThemePreference>(readStored())

  watch(preference, (value) => {
    applyTheme(value)
    try {
      if (value === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // 存不進去不影響當前工作階段的主題
    }
  })

  let media: MediaQueryList | null = null
  const onSystemChange = () => {
    // 只有在「跟隨系統」時才需要回應系統變化
    if (preference.value === 'system') applyTheme('system')
  }

  onMounted(() => {
    applyTheme(preference.value)
    if (typeof matchMedia === 'function') {
      media = matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', onSystemChange)
    }
  })
  onBeforeUnmount(() => media?.removeEventListener('change', onSystemChange))

  function cycle(): void {
    preference.value =
      preference.value === 'system' ? 'light' : preference.value === 'light' ? 'dark' : 'system'
  }

  return { preference, cycle }
}
