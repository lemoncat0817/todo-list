import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoMain from '@/components/todoMain.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { freshPinia, mountWith, stubDialogs, makeTask } from '@/test/helpers'

/**
 * 鎖定 todoMain.vue 的既有行為。
 * 標示 [現況] 的案例記錄稽核報告指出的缺陷，修正後應轉紅。
 */
describe('todoMain.vue', () => {
  let pinia
  let store
  let dialogs

  beforeEach(() => {
    pinia = freshPinia()
    store = useTodoTaskStore()
    dialogs = stubDialogs()
  })
  afterEach(() => vi.restoreAllMocks())

  const rows = (w) => w.findAll('div.bg-gray-300')
  const names = (w) => rows(w).map((r) => r.find('p').text())
  const seed = () => {
    store.todoList = [
      makeTask('Buy Milk', false, { id: 1 }),
      makeTask('buy milk', true, { id: 2 }),
      makeTask('寫測試', false, { id: 3 }),
    ]
  }

  describe('taskList 過濾矩陣（todoMain.vue:67-85）', () => {
    it('keyword 為空 + pages=0 顯示全部', () => {
      seed()
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['Buy Milk', 'buy milk', '寫測試'])
    })

    it('keyword 為空 + pages=1 只顯示未完成', () => {
      seed()
      store.pages = 1
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['Buy Milk', '寫測試'])
    })

    it('keyword 為空 + pages=2 只顯示已完成', () => {
      seed()
      store.pages = 2
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['buy milk'])
    })

    it('有 keyword + pages=0 對全部做關鍵字過濾', () => {
      seed()
      store.keyword = 'buy'
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['buy milk'])
    })

    it('有 keyword + pages=1 同時套用未完成與關鍵字', () => {
      seed()
      store.keyword = 'i'
      store.pages = 1
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['Buy Milk'])
    })

    it('有 keyword + pages=2 同時套用已完成與關鍵字', () => {
      seed()
      store.keyword = 'i'
      store.pages = 2
      const w = mountWith(todoMain, pinia)
      expect(names(w)).toEqual(['buy milk'])
    })

    it('[現況] 搜尋大小寫敏感，keyword="buy" 找不到 "Buy Milk"（稽核 P4）', () => {
      seed()
      store.keyword = 'buy'
      const w = mountWith(todoMain, pinia)
      expect(names(w)).not.toContain('Buy Milk')
      expect(names(w)).toEqual(['buy milk'])
    })

    it('[現況] pages 超出 0/1/2 時 taskList 為 undefined，清單靜默清空（稽核 P3）', () => {
      seed()
      store.pages = 7
      const w = mountWith(todoMain, pinia)
      expect(rows(w)).toHaveLength(0)
    })

    it('[現況] 有 keyword 且 pages 超出範圍時同樣靜默清空（稽核 P3）', () => {
      seed()
      store.keyword = 'buy'
      store.pages = 7
      const w = mountWith(todoMain, pinia)
      expect(rows(w)).toHaveLength(0)
    })
  })

  describe('分頁切換守衛（todoMain.vue:87-101）', () => {
    const tab = (w, i) => w.findAll('div.w-20')[i]

    it('點「全部」直接切到 pages=0', async () => {
      seed()
      store.pages = 1
      const w = mountWith(todoMain, pinia)
      await tab(w, 0).trigger('click')
      expect(store.pages).toBe(0)
    })

    it('有未完成項目時，「未完成」可切換', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await tab(w, 1).trigger('click')
      expect(store.pages).toBe(1)
    })

    it('沒有未完成項目時，「未完成」被擋下並跳 alert', async () => {
      store.todoList = [makeTask('done', true)]
      const w = mountWith(todoMain, pinia)
      await tab(w, 1).trigger('click')

      expect(store.pages).toBe(0)
      expect(dialogs.alerts).toEqual(['暫無未完成事項，請先添加'])
    })

    it('有已完成項目時，「完成」可切換', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await tab(w, 2).trigger('click')
      expect(store.pages).toBe(2)
    })

    it('沒有已完成項目時，「完成」被擋下並跳 alert', async () => {
      store.todoList = [makeTask('todo', false)]
      const w = mountWith(todoMain, pinia)
      await tab(w, 2).trigger('click')

      expect(store.pages).toBe(0)
      expect(dialogs.alerts).toEqual(['暫無完成事項，請先添加'])
    })
  })

  describe('編輯與保存（todoMain.vue:45-61）', () => {
    const editBtn = (w, i) => rows(w)[i].findAll('button')[0]
    const deleteBtn = (w, i) => rows(w)[i].findAll('button')[1]
    const editInput = (w, i) => rows(w)[i].find('input[placeholder="請輸入編輯內容"]')

    it('點編輯後顯示輸入框，且帶入原本的內容', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await editBtn(w, 0).trigger('click')

      expect(store.todoList[0].isEdit).toBe(true)
      expect(editInput(w, 0).element.value).toBe('Buy Milk')
    })

    it('保存後寫回新內容並離開編輯狀態', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('Buy Oat Milk')
      await rows(w)[0].findAll('button')[0].trigger('click')

      expect(store.todoList[0].taskName).toBe('Buy Oat Milk')
      expect(store.todoList[0].isEdit).toBe(false)
    })

    it('編輯內容清空時保存被擋下，仍留在編輯狀態', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('')
      await rows(w)[0].findAll('button')[0].trigger('click')

      expect(store.todoList[0].isEdit).toBe(true)
      expect(store.todoList[0].taskName).toBe('Buy Milk')
      expect(dialogs.alerts).toEqual(['請輸入編輯內容'])
    })

    it('已有項目在編輯中時，不能編輯另一個項目', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await editBtn(w, 0).trigger('click')
      await editBtn(w, 1).trigger('click')

      expect(store.todoList[1].isEdit).toBe(false)
      expect(dialogs.alerts).toEqual(['有待辦事項尚未保存，請先完成編輯'])
    })

    it('[現況] isEdit 被持久化但編輯暫存值不是，重新載入後整份清單被鎖住（稽核 P1）', async () => {
      // 模擬「編輯中重新整理」：store 還原了 isEdit=true，但元件的 editTaskName 是全新的空字串
      store.todoList = [
        makeTask('原本的內容', false, { id: 1, isEdit: true }),
        makeTask('另一筆', false, { id: 2 }),
      ]
      const w = mountWith(todoMain, pinia)

      // 原文字看不見了，輸入框是空的
      expect(editInput(w, 0).element.value).toBe('')
      expect(rows(w)[0].find('p').exists()).toBe(false)

      // 想保存 → 被空值檢查擋下
      await rows(w)[0].findAll('button')[0].trigger('click')
      expect(store.todoList[0].isEdit).toBe(true)
      expect(dialogs.alerts).toContain('請輸入編輯內容')

      // 想改編輯別筆 → 被守衛擋下，整份清單卡住
      await editBtn(w, 1).trigger('click')
      expect(store.todoList[1].isEdit).toBe(false)
      expect(dialogs.alerts).toContain('有待辦事項尚未保存，請先完成編輯')
    })

    it('刪除依 id 移除項目', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await deleteBtn(w, 0).trigger('click')

      expect(store.todoList.map((t) => t.id)).toEqual([2, 3])
    })

    it('[現況] id 碰撞時，刪除一筆會連帶刪掉另一筆（稽核 P17 的實際危害）', async () => {
      // Date.now() 當 id，同毫秒新增的兩筆會拿到相同的值
      store.todoList = [
        makeTask('同毫秒 A', false, { id: 1_700_000_000_000 }),
        makeTask('同毫秒 B', false, { id: 1_700_000_000_000 }),
        makeTask('不相干', false, { id: 1_700_000_000_001 }),
      ]
      const w = mountWith(todoMain, pinia)
      await deleteBtn(w, 0).trigger('click')

      expect(store.todoList.map((t) => t.taskName)).toEqual(['不相干'])
    })

    it('[現況] 刪除不需要任何確認（稽核 P16）', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await deleteBtn(w, 0).trigger('click')

      expect(dialogs.confirms).toEqual([])
      expect(store.todoList).toHaveLength(2)
    })
  })

  describe('完成狀態勾選（todoMain.vue:17）', () => {
    it('勾選 checkbox 會更新該項目的 isCompleted', async () => {
      seed()
      const w = mountWith(todoMain, pinia)
      await rows(w)[0].find('input[type="checkbox"]').setValue(true)
      expect(store.todoList[0].isCompleted).toBe(true)
    })

    it('已完成的項目加上刪除線', () => {
      seed()
      const w = mountWith(todoMain, pinia)
      expect(rows(w)[1].find('p').classes()).toContain('line-through')
      expect(rows(w)[0].find('p').classes()).not.toContain('line-through')
    })
  })
})
