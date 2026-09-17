import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import AppFooter from '@/components/AppFooter.vue'
import { useTasksStore } from '@/stores/tasks'
import { useHistoryStore } from '@/stores/history'
import { useFlashStore } from '@/stores/flash'
import { useSyncStore } from '@/stores/sync'
import type { Pinia } from 'pinia'
import { freshPinia, mountWith, makeTask, at, type Wrapper } from '@/test/helpers'

/**
 * AppFooter 的統計與「清除已完成」。
 *
 * 稽核 P15 / P16：原本每個破壞性操作都跳阻塞式 confirm 再跳 alert 回報結果。
 * 現在改為做完之後可復原 —— 不打斷流程，而且真的救得回來。
 */
describe('AppFooter.vue', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTasksStore>
  let history: ReturnType<typeof useHistoryStore>

  beforeEach(() => {
    pinia = freshPinia()
    store = useTasksStore()
    history = useHistoryStore()
    // 元件測試針對已載入完成的狀態；載入流程由 db 層的測試負責。
    store.isLoading = false
  })
  afterEach(() => {
    useSyncStore().stop()
    vi.restoreAllMocks()
  })

  /** 三個計數在同一個 p 裡；抓文字比抓元素穩固，改樣式不會連累測試。 */
  const counters = (w: Wrapper) => w.find('footer p').text().replace(/\s+/g, '')
  const undoButton = (w: Wrapper) => w.find('button[data-test=undo]')

  describe('統計數字', () => {
    it('空清單時三個計數都是 0', () => {
      const w = mountWith(AppFooter, pinia)
      expect(counters(w)).toBe('全部:0項·未完成:0項·已完成:0項')
    })

    it('正確反映全部／未完成／已完成的數量', () => {
      store.items = [
        makeTask('a', true),
        makeTask('b', false),
        makeTask('c', false),
        makeTask('d', true),
      ]
      const w = mountWith(AppFooter, pinia)
      expect(counters(w)).toBe('全部:4項·未完成:2項·已完成:2項')
    })

    it('清單變動後計數同步更新', async () => {
      store.items = [makeTask('a', false)]
      const w = mountWith(AppFooter, pinia)
      expect(counters(w)).toBe('全部:1項·未完成:1項·已完成:0項')

      at(store.items, 0).isCompleted = true
      await w.vm.$nextTick()
      expect(counters(w)).toBe('全部:1項·未完成:0項·已完成:1項')
    })
  })

  describe('可復原操作提示', () => {
    it('有操作紀錄時顯示提示，按下復原即還原', async () => {
      store.items = [
        makeTask('done-1', true, { id: '1' }),
        makeTask('todo-1', false, { id: '2' }),
      ]
      store.clearCompleted()
      const w = mountWith(AppFooter, pinia)

      expect(w.text()).toContain('清除 1 項已完成')
      expect(history.canUndo).toBe(true)

      await undoButton(w).trigger('click')
      await w.vm.$nextTick()
      expect(store.items.map((t) => t.id).sort()).toEqual(['1', '2'])
    })

    it('提示可以關閉', async () => {
      store.items = [makeTask('a', true)]
      store.clearCompleted()
      const w = mountWith(AppFooter, pinia)
      expect(w.text()).toContain('清除 1 項已完成')

      await w.find('button[aria-label="關閉提示"]').trigger('click')
      await w.vm.$nextTick()
      expect(w.find('button[aria-label="關閉提示"]').exists()).toBe(false)
    })
  })

  describe('錯誤提示', () => {
    it('顯示 flash 錯誤訊息，可用關閉按鈕清掉', async () => {
      const flash = useFlashStore()
      flash.error('無法載入工作區資料，請稍後再試一次')
      const w = mountWith(AppFooter, pinia)

      expect(w.get('[data-test=flash]').text()).toContain('無法載入工作區資料，請稍後再試一次')
      expect(w.get('[data-test=flash]').attributes('role')).toBe('alert')

      await w.find('button[aria-label="關閉提示"]').trigger('click')
      await w.vm.$nextTick()
      expect(w.find('[data-test=flash]').exists()).toBe(false)
    })

    it('flash 優先於可復原操作提示', async () => {
      store.items = [makeTask('a', true)]
      store.clearCompleted()
      const w = mountWith(AppFooter, pinia)
      useFlashStore().error('同步以外的錯誤')
      await w.vm.$nextTick()

      expect(w.find('[data-test=flash]').exists()).toBe(true)
      expect(w.find('[data-test=last-action]').exists()).toBe(false)
      expect(w.get('[data-test=flash]').text()).toContain('同步以外的錯誤')
    })

    it('本地寫入失敗時顯示存檔提示', async () => {
      store.writeError = new Error('配額已滿')
      const w = mountWith(AppFooter, pinia)
      expect(w.get('[data-test=write-error]').text()).toContain('變更尚未存檔')
    })

    it('同步失敗時在頁尾顯示友善訊息', async () => {
      useSyncStore().syncError = '目前連不上網路，恢復連線後會自動重試'
      const w = mountWith(AppFooter, pinia)
      expect(w.get('[data-test=sync-error]').text()).toContain('目前連不上網路，恢復連線後會自動重試')
    })
  })
})
