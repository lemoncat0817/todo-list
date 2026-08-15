import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoHeader from '@/components/todoHeader.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import type { Pinia } from 'pinia'
import { freshPinia, mountWith, stubDialogs, makeTask, at, asInput, type Wrapper, type DialogLog } from '@/test/helpers'

/**
 * 鎖定 todoHeader.vue 的既有行為。
 * 標示 [現況] 的案例是刻意記錄「目前就是這樣」，含稽核報告指出的缺陷；
 * 之後的階段修正時這些測試會轉紅，那正是我們要的改變證明。
 */
describe('todoHeader.vue', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTodoTaskStore>
  let dialogs: DialogLog

  beforeEach(() => {
    pinia = freshPinia()
    store = useTodoTaskStore()
    // 元件測試針對已載入完成的狀態；載入流程由 db 層的測試負責。
    store.isLoading = false
    dialogs = stubDialogs()
  })
  afterEach(() => vi.restoreAllMocks())

  const textInput = (w: Wrapper) => w.find('input[placeholder="請輸入代辦事項"]')
  const addButton = (w: Wrapper) => w.find('button.bg-blue-500')

  describe('addTask（todoHeader.vue:36-47）', () => {
    it('輸入內容後新增，並清空輸入框', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('寫測試')
      await addButton(w).trigger('click')

      expect(store.todoList).toHaveLength(1)
      expect(at(store.todoList, 0)).toMatchObject({
        taskName: '寫測試',
        isCompleted: false,
      })
      // P1 修正後不再把編輯狀態寫進領域資料
      expect(at(store.todoList, 0)).not.toHaveProperty('isEdit')
      expect(asInput(textInput(w)).value).toBe('')
    })

    it('空字串不新增，改跳 alert', async () => {
      const w = mountWith(todoHeader, pinia)
      await addButton(w).trigger('click')

      expect(store.todoList).toHaveLength(0)
      expect(dialogs.alerts).toEqual(['請輸入代辦事項'])
    })

    it('只有空白字元時，v-model.trim 會使其成為空字串而不新增', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('    ')
      await addButton(w).trigger('click')

      expect(store.todoList).toHaveLength(0)
      expect(dialogs.alerts).toEqual(['請輸入代辦事項'])
    })

    it('按下 Enter 也能新增', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('用 Enter 新增')
      await textInput(w).trigger('keyup.enter')

      expect(store.todoList).toHaveLength(1)
      expect(at(store.todoList, 0).taskName).toBe('用 Enter 新增')
    })

    it('id 改用 randomUUID，不再是時間戳（稽核 P17 已修正）', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('第一筆')
      await addButton(w).trigger('click')
      await textInput(w).setValue('第二筆')
      await addButton(w).trigger('click')

      const ids = store.todoList.map((t) => t.id)
      expect(ids).toHaveLength(2)
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      }
      expect(new Set(ids).size, '不同筆必須是不同 id').toBe(2)
    })

    it('新增時給定遞增的排序鍵', async () => {
      const w = mountWith(todoHeader, pinia)
      for (const name of ['一', '二', '三']) {
        await textInput(w).setValue(name)
        await addButton(w).trigger('click')
      }
      expect(store.todoList.map((t) => t.order)).toEqual([0, 1, 2])
    })
  })

  describe('isAll 全選 computed（todoHeader.vue:49-58）', () => {
    const checkbox = (w: Wrapper) => w.find('input[type="checkbox"]')

    it('全部完成時為已勾選', () => {
      store.todoList = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(todoHeader, pinia)
      expect(asInput(checkbox(w)).checked).toBe(true)
    })

    it('有任一未完成時為未勾選', () => {
      store.todoList = [makeTask('a', true), makeTask('b', false)]
      const w = mountWith(todoHeader, pinia)
      expect(asInput(checkbox(w)).checked).toBe(false)
    })

    it('勾選時將全部標記為完成', async () => {
      store.todoList = [makeTask('a', false), makeTask('b', false)]
      const w = mountWith(todoHeader, pinia)
      await checkbox(w).setValue(true)
      expect(store.todoList.every((t) => t.isCompleted)).toBe(true)
    })

    it('取消勾選時將全部標記為未完成', async () => {
      store.todoList = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(todoHeader, pinia)
      await checkbox(w).setValue(false)
      expect(store.todoList.every((t) => !t.isCompleted)).toBe(true)
    })

    it('[現況] 清單為空時 every() 回傳 true，全選框呈現已勾選（稽核 P13）', () => {
      const w = mountWith(todoHeader, pinia)
      expect(store.todoList).toHaveLength(0)
      expect(asInput(checkbox(w)).checked).toBe(true)
    })

    it('[現況] 清單為空時全選框加上 invisible（僅視覺隱藏）', () => {
      const w = mountWith(todoHeader, pinia)
      expect(checkbox(w).classes()).toContain('invisible')
    })
  })

  describe('searchMode 切換（todoHeader.vue:60-64）', () => {
    const modeButton = (w: Wrapper) => w.find('button.bg-green-500')

    it('切換 isSearch，並顯示對應字樣', async () => {
      const w = mountWith(todoHeader, pinia)
      expect(modeButton(w).text()).toBe('搜尋模式🔍')

      await modeButton(w).trigger('click')
      expect(store.isSearch).toBe(true)
      expect(modeButton(w).text()).toBe('回列表模式📋')
    })

    it('切換時清空 keyword', async () => {
      store.isSearch = true
      store.keyword = '既有關鍵字'
      const w = mountWith(todoHeader, pinia)
      await modeButton(w).trigger('click')

      expect(store.isSearch).toBe(false)
      expect(store.keyword).toBe('')
    })

    it('搜尋模式下顯示關鍵字輸入框，隱藏新增輸入框', async () => {
      const w = mountWith(todoHeader, pinia)
      await modeButton(w).trigger('click')

      expect(textInput(w).exists()).toBe(false)
      expect(w.find('input[placeholder="請輸入關鍵字"]').exists()).toBe(true)
    })

    it('關鍵字輸入會寫進 store', async () => {
      store.isSearch = true
      const w = mountWith(todoHeader, pinia)
      await w.find('input[placeholder="請輸入關鍵字"]').setValue('牛奶')
      expect(store.keyword).toBe('牛奶')
    })
  })
})
