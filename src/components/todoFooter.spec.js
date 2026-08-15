import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoFooter from '@/components/todoFooter.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { freshPinia, mountWith, stubDialogs, makeTask } from '@/test/helpers'

/**
 * 鎖定 todoFooter.vue 的既有行為。
 * clearTask 是稽核報告點名要先補測試的狀態轉換邏輯。
 */
describe('todoFooter.vue', () => {
  let pinia
  let store

  beforeEach(() => {
    pinia = freshPinia()
    store = useTodoTaskStore()
  })
  afterEach(() => vi.restoreAllMocks())

  const counters = (w) => w.findAll('div.bg-blue-500').map((d) => d.text().replace(/\s+/g, ''))
  const clearButton = (w) => w.find('button')

  describe('統計數字（todoFooter.vue:4-12）', () => {
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

      store.todoList[0].isCompleted = true
      await w.vm.$nextTick()
      expect(counters(w)).toEqual(['全部:1項', '未完成:0項', '已完成:1項'])
    })
  })

  describe('clearTask 狀態轉換（todoFooter.vue:23-35）', () => {
    it('沒有已完成項目時，跳 alert 且不詢問確認', async () => {
      const dialogs = stubDialogs()
      store.todoList = [makeTask('a', false)]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(dialogs.alerts).toEqual(['目前沒有已完成的代辦事項'])
      expect(dialogs.confirms).toEqual([])
      expect(store.todoList).toHaveLength(1)
    })

    it('確認後移除全部已完成項目，保留未完成', async () => {
      const dialogs = stubDialogs({ confirmReturns: true })
      store.todoList = [
        makeTask('done-1', true, { id: 1 }),
        makeTask('todo-1', false, { id: 2 }),
        makeTask('done-2', true, { id: 3 }),
      ]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(dialogs.confirms).toEqual(['確定要清除所有已完成代辦事項嗎？'])
      expect(store.todoList.map((t) => t.id)).toEqual([2])
      expect(dialogs.alerts).toEqual(['清除成功'])
    })

    it('取消確認時不改動任何資料', async () => {
      const dialogs = stubDialogs({ confirmReturns: false })
      store.todoList = [
        makeTask('done-1', true, { id: 1 }),
        makeTask('todo-1', false, { id: 2 }),
      ]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(store.todoList.map((t) => t.id)).toEqual([1, 2])
      expect(dialogs.alerts).toEqual(['取消操作'])
    })

    it('全部都是已完成時，清空整份清單', async () => {
      stubDialogs({ confirmReturns: true })
      store.todoList = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(todoFooter, pinia)
      await clearButton(w).trigger('click')

      expect(store.todoList).toHaveLength(0)
    })
  })
})
