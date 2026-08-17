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

  const textInput = (w: Wrapper) => w.find('input[aria-label="新增代辦事項"]')
  const addButton = (w: Wrapper) => w.find('button[aria-label="新增"]')

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

    it('空字串時新增鈕停用，不用 alert 事後責備', async () => {
      const w = mountWith(todoHeader, pinia)
      expect(addButton(w).attributes('disabled'), '按鈕應停用').toBeDefined()
      expect(store.todoList).toHaveLength(0)
      expect(dialogs.alerts, '不該再用阻塞式對話框').toEqual([])
    })

    it('只有空白字元時，v-model.trim 使其成為空字串，按鈕維持停用', async () => {
      const w = mountWith(todoHeader, pinia)
      await textInput(w).setValue('    ')
      expect(addButton(w).attributes('disabled')).toBeDefined()
      expect(store.todoList).toHaveLength(0)
      expect(dialogs.alerts).toEqual([])
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

    it('清單為空時全選框不顯示為已勾選（稽核 P13 已修正）', () => {
      const w = mountWith(todoHeader, pinia)
      expect(store.todoList).toHaveLength(0)
      // [].every() 依規範回傳 true，所以要額外檢查長度，否則空清單會顯示為全部完成
      expect(checkbox(w).exists(), '空清單時整個全選框不渲染').toBe(false)
    })

    it('有項目時才渲染全選框，不再用 invisible 留一個看不見的控制項', () => {
      expect(mountWith(todoHeader, pinia).find('input[type="checkbox"]').exists()).toBe(false)
      store.todoList = [makeTask('a', false)]
      expect(mountWith(todoHeader, pinia).find('input[type="checkbox"]').exists()).toBe(true)
    })
  })

  describe('searchMode 切換（todoHeader.vue:60-64）', () => {
    const modeButton = (w: Wrapper) =>
    w.find(`button[aria-label="搜尋代辦事項"], button[aria-label="結束搜尋"]`)

    it('切換 isSearch，並以 aria-label 與 aria-pressed 表達狀態', async () => {
      const w = mountWith(todoHeader, pinia)
      expect(modeButton(w).attributes('aria-label')).toBe('搜尋代辦事項')
      expect(modeButton(w).attributes('aria-pressed')).toBe('false')

      await modeButton(w).trigger('click')
      expect(store.isSearch).toBe(true)
      expect(modeButton(w).attributes('aria-label')).toBe('結束搜尋')
      expect(modeButton(w).attributes('aria-pressed')).toBe('true')
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
      expect(w.find('input[aria-label="搜尋代辦事項"]').exists()).toBe(true)
    })

    it('關鍵字輸入會寫進 store', async () => {
      store.isSearch = true
      const w = mountWith(todoHeader, pinia)
      await w.find('input[aria-label="搜尋代辦事項"]').setValue('牛奶')
      expect(store.keyword).toBe('牛奶')
    })
  })
})
