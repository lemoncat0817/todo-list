import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoFooter from '@/components/todoFooter.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import type { Pinia } from 'pinia'
import { freshPinia, mountWith, makeTask, at, stubDialogs, type Wrapper } from '@/test/helpers'

/**
 * todoFooter 的統計與「清除已完成」。
 *
 * 稽核 P15 / P16：原本每個破壞性操作都跳阻塞式 confirm 再跳 alert 回報結果。
 * 現在改為做完之後可復原 —— 不打斷流程，而且真的救得回來。
 */
describe('todoFooter.vue', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTodoTaskStore>

  beforeEach(() => {
    pinia = freshPinia()
    store = useTodoTaskStore()
    // 元件測試針對已載入完成的狀態；載入流程由 db 層的測試負責。
    store.isLoading = false
  })
  afterEach(() => vi.restoreAllMocks())

  const counters = (w: Wrapper) =>
    w.findAll('div.bg-blue-700').map((d) => d.text().replace(/\s+/g, ''))
  const clearButton = (w: Wrapper) => w.find('button.bg-blue-900')
  const undoButton = (w: Wrapper) => w.find('button.bg-blue-900.text-white.rounded.px-2')

  describe('統計數字', () => {
    it('空清單時三個計數都是 0', () => {
      const w = mountWith(todoFooter, pinia)
      expect(counters(w)).toEqual(['全部:0項', '未完成:0項', '已完成:0項'])
    })

    it('正確反映全部／未完成／已完成的數量', () => {
      store.todoList = [
        makeTask('a', true),
        makeTask('b', false),
        makeTask('c', false),
        makeTask('d', true),
      ]
      const w = mountWith(todoFooter, pinia)
      expect(counters(w)).toEqual(['全部:4項', '未完成:2項', '已完成:2項'])
    })

    it('清單變動後計數同步更新', async () => {
      store.todoList = [makeTask('a', false)]
      const w = mountWith(todoFooter, pinia)
      expect(counters(w)).toEqual(['全部:1項', '未完成:1項', '已完成:0項'])

      at(store.todoList, 0).isCompleted = true
      await w.vm.$nextTick()
      expect(counters(w)).toEqual(['全部:1項', '未完成:0項', '已完成:1項'])
    })
  })

  describe('清除已完成', () => {
    it('沒有已完成項目時按鈕停用，不再用 alert 攔截', async () => {
      const dialogs = stubDialogs()
      store.todoList = [makeTask('a', false)]
      const w = mountWith(todoFooter, pinia)

      expect(clearButton(w).attributes('disabled')).toBeDefined()
      expect(dialogs.alerts, '不應再用 alert 攔截').toEqual([])
    })

    it('直接清除已完成項目，不再跳 confirm', async () => {
      const dialogs = stubDialogs()
      store.todoList = [
        makeTask('done-1', true, { id: '1' }),
        makeTask('todo-1', false, { id: '2' }),
        makeTask('done-2', true, { id: '3' }),
      ]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(dialogs.confirms, '不應再有阻塞式對話框').toEqual([])
      expect(store.todoList.map((t) => t.id)).toEqual(['2'])
    })

    it('清除後顯示可復原提示，按下復原即還原', async () => {
      store.todoList = [
        makeTask('done-1', true, { id: '1' }),
        makeTask('todo-1', false, { id: '2' }),
      ]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(w.text()).toContain('清除 1 項已完成')
      expect(store.canUndo).toBe(true)

      await undoButton(w).trigger('click')
      await w.vm.$nextTick()
      expect(store.todoList.map((t) => t.id).sort()).toEqual(['1', '2'])
    })

    it('全部都是已完成時，清空整份清單且仍可復原', async () => {
      store.todoList = [makeTask('a', true, { id: '1' }), makeTask('b', true, { id: '2' })]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(store.todoList).toHaveLength(0)

      await store.undo()
      expect(store.todoList).toHaveLength(2)
    })

    it('提示可以關閉', async () => {
      store.todoList = [makeTask('a', true)]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')
      expect(w.text()).toContain('清除 1 項已完成')

      await w.find('button[aria-label="關閉提示"]').trigger('click')
      await w.vm.$nextTick()
      expect(w.find('button[aria-label="關閉提示"]').exists()).toBe(false)
    })
  })
})
