import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { createPersistPlugin } from '@/infra/persist'
import { usePrefsStore } from '@/stores/prefs'

/**
 * 這個 store 存在的理由就是持久化，所以測試也繞著「跨信任邊界的資料」打轉：
 * localStorage 是使用者、別的分頁、甚至舊版的自己都能寫進任意內容的地方。
 */
function setup() {
  const pinia = createPinia()
  pinia.use(createPersistPlugin())
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return usePrefsStore()
}

describe('prefs store', () => {
  beforeEach(() => localStorage.clear())

  it('預設是手動順序、不分組——不主動改變使用者已經排好的樣子', () => {
    const prefs = setup()
    expect(prefs.sortBy).toBe('manual')
    expect(prefs.groupBy).toBe('none')
  })

  it('選擇會被記住', async () => {
    setup().setSort('due')
    // Pinia 的 $subscribe 預設在下一個 tick 才觸發，寫入不是同步的
    await nextTick()
    expect(localStorage.getItem('todoTask:prefs')).toContain('due')
    expect(setup().sortBy, '重新建立後仍是 due').toBe('due')
  })

  it('壞掉的值退回預設，而不是讓清單因為一個不存在的排序鍵消失', () => {
    for (const bad of [
      '{"sortBy":"不存在的排序","groupBy":"亂寫"}',
      '{"sortBy":42}',
      '"整份不是物件"',
      'null',
    ]) {
      localStorage.setItem('todoTask:prefs', bad)
      const prefs = setup()
      expect(prefs.sortBy, bad).toBe('manual')
      expect(prefs.groupBy, bad).toBe('none')
    }
  })

  it('JSON 語法錯誤不會讓整個 store 掛掉', () => {
    localStorage.setItem('todoTask:prefs', '{壞掉的 json')
    expect(setup().sortBy).toBe('manual')
  })
})
