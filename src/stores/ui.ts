import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createPersistOptions } from '@/infra/persist'

/**
 * UI 偏好。
 *
 * 與領域資料分開持久化：任務本體在 IndexedDB，這裡只有幾個小旗標，
 * 用 localStorage 反而更合適（同步讀取、開頁時不需要等）。
 */

interface UiPrefs {
  isSearch: boolean
  keyword: string
}

/** 邊界驗證：外部寫進來的壞值不該影響畫面（稽核 P2 的教訓）。 */
function sanitizeUiPrefs(raw: unknown): Partial<UiPrefs> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const prefs: Partial<UiPrefs> = {}
  if (typeof value.isSearch === 'boolean') prefs.isSearch = value.isSearch
  if (typeof value.keyword === 'string') prefs.keyword = value.keyword
  return prefs
}

export const useUiStore = defineStore(
  'ui',
  () => {
    const isSearch = ref(false)
    const keyword = ref('')

    function toggleSearch(): void {
      isSearch.value = !isSearch.value
      // 離開搜尋時清空關鍵字，否則回到清單會看到被過濾過的結果卻沒有可見的原因
      keyword.value = ''
    }

    return { isSearch, keyword, toggleSearch }
  },
  { persist: createPersistOptions('todoTask:ui', sanitizeUiPrefs) },
)
