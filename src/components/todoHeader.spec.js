import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoHeader from '@/components/todoHeader.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { freshPinia, mountWith, stubDialogs, makeTask } from '@/test/helpers'

/**
 * 鎖定 todoHeader.vue 的既有行為。
 * 標示 [現況] 的案例是刻意記錄「目前就是這樣」，含稽核報告指出的缺陷；
 * 之後的階段修正時這些測試會轉紅，那正是我們要的改變證明。
 */
describe('todoHeader.vue', () => {
  let pinia
  let store
  let dialogs

  beforeEach(() => {
    pinia = freshPinia()
    store = useTodoTaskStore()
    dialogs = stubDialogs()
  })
  afterEach(() => vi.restoreAllMocks())

  const textInput = (w) => w.find('input[placeholder="請輸入代辦事項"]')
  const addButton = (w) => w.find('button.bg-blue-500')

  describe('addTask（todoHeader.vue:36-47）', () => {
    it('輸入內容後新增，並清空輸入框', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('寫測試')
      await addButton(w).trigger('click')

      expect(store.todoList).toHaveLength(1)
      expect(store.todoList[0]).toMatchObject({
        taskName: '寫測試',
        isCompleted: false,
        isEdit: false,
      })
      expect(textInput(w).element.value).toBe('')
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
      expect(store.todoList[0].taskName).toBe('用 Enter 新增')
    })

    it('[現況] id 直接取自 Date.now()，因此同毫秒新增必然碰撞（稽核 P17）', async () => {
      const w = mountWith(todoHeader, pinia)
      const before = Date.now()
      await textInput(w).setValue('看看 id 從哪來')
      await addButton(w).trigger('click')
      const after = Date.now()

      // id 落在呼叫前後的時間區間內，證明它就是一個毫秒時間戳，
      // 沒有任何額外的唯一性來源 —— 同毫秒的兩次新增必然拿到同一個值。
      expect(store.todoList[0].id).toBeGreaterThanOrEqual(before)
      expect(store.todoList[0].id).toBeLessThanOrEqual(after)
    })
  })

  describe('isAll 全選 computed（todoHeader.vue:49-58）', () => {
    const checkbox = (w) => w.find('input[type="checkbox"]')

    it('全部完成時為已勾選', () => {
      store.todoList = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(todoHeader, pinia)
      expect(checkbox(w).element.checked).toBe(true)
    })

    it('有任一未完成時為未勾選', () => {
      store.todoList = [makeTask('a', true), makeTask('b', false)]
      const w = mountWith(todoHeader, pinia)
      expect(checkbox(w).element.checked).toBe(false)
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
      expect(checkbox(w).element.checked).toBe(true)
    })

    it('[現況] 清單為空時全選框加上 invisible（僅視覺隱藏）', () => {
      const w = mountWith(todoHeader, pinia)
      expect(checkbox(w).classes()).toContain('invisible')
    })
  })

  describe('searchMode 切換（todoHeader.vue:60-64）', () => {
    const modeButton = (w) => w.find('button.bg-green-500')

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
