import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import todoMain from '@/components/todoMain.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import type { Pinia } from 'pinia'
import type { TaskFilter } from '@/router/filters'
import {
  freshPinia, mountWith, stubDialogs, makeTask, at, asInput, testRouter,
  type Wrapper, type DialogLog,
} from '@/test/helpers'

/**
 * 鎖定 todoMain.vue 的既有行為。
 * 標示 [現況] 的案例記錄稽核報告指出的缺陷，修正後應轉紅。
 */
describe('todoMain.vue', () => {
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

  const rows = (w: Wrapper) => w.findAll('div.bg-gray-300')
  const names = (w: Wrapper) => rows(w).map((r) => r.find('p').text())
  const seed = () => {
    store.todoList = [
      makeTask('Buy Milk', false, { id: '1' }),
      makeTask('buy milk', true, { id: '2' }),
      makeTask('寫測試', false, { id: '3' }),
    ]
  }
  describe('taskList 過濾（由路由 filter prop 驅動）', () => {
    it('filter=all 顯示全部', () => {
      seed()
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk', '寫測試'])
    })

    it('filter 未指定時預設為 all', () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk', '寫測試'])
    })

    it('filter=active 只顯示未完成', () => {
      seed()
      const w = mountWith(todoMain, pinia, { props: { filter: 'active' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', '寫測試'])
    })

    it('filter=completed 只顯示已完成', () => {
      seed()
      const w = mountWith(todoMain, pinia, { props: { filter: 'completed' }, router: testRouter() })
      expect(names(w)).toEqual(['buy milk'])
    })

    it('keyword 疊加 filter=all', () => {
      seed()
      store.keyword = 'buy'
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk'])
    })

    it('keyword 疊加 filter=active', () => {
      seed()
      store.keyword = 'i'
      const w = mountWith(todoMain, pinia, { props: { filter: 'active' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk'])
    })

    it('keyword 疊加 filter=completed', () => {
      seed()
      store.keyword = 'i'
      const w = mountWith(todoMain, pinia, { props: { filter: 'completed' }, router: testRouter() })
      expect(names(w)).toEqual(['buy milk'])
    })

    it('搜尋大小寫不敏感（稽核 P4 已修正）', () => {
      seed()
      store.keyword = 'buy'
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk'])
    })

    it('全形關鍵字可命中半形內容（稽核 P4 已修正）', () => {
      store.todoList = [makeTask('Buy Milk', false, { id: '1' })]
      store.keyword = 'ＢＵＹ'
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk'])
    })

    it.each(['bogus', '', null, undefined, 7])(
      'filter=%s 這類非預期值一律退回完整清單，不再是 undefined（稽核 P3）',
      (bad) => {
        seed()
        const w = mountWith(todoMain, pinia, {
          props: { filter: bad as unknown as TaskFilter },
          router: testRouter(),
        })
        expect(rows(w)).toHaveLength(3)
      },
    )
  })

  describe('分頁導覽（改為路由連結）', () => {
    const tabs = (w: Wrapper) => w.findAll('nav a')

    it('三個分頁指向對應的路由', () => {
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(tabs(w).map((a) => a.text())).toEqual(['全部', '未完成', '完成'])
      expect(tabs(w).map((a) => a.attributes('href'))).toEqual(['/', '/active', '/completed'])
    })

    it('目前所在的分頁標上 aria-current="page"', () => {
      const w = mountWith(todoMain, pinia, {
        props: { filter: 'completed' },
        router: testRouter(),
      })
      const current = tabs(w).map((a) => a.attributes('aria-current'))
      expect(current).toEqual([undefined, undefined, 'page'])
    })

    it('分頁是真正的連結，鍵盤可聚焦（稽核 P6 的一部分）', () => {
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router: testRouter() })
      for (const a of tabs(w)) {
        expect(a.element.tagName).toBe('A')
        expect(a.attributes('href')).toBeTruthy()
      }
    })

    it('清單為空時仍可切換分頁，不再跳 alert 攔截', async () => {
      const router = testRouter()
      const w = mountWith(todoMain, pinia, { props: { filter: 'all' }, router })
      await at(tabs(w), 1).trigger('click')
      await router.isReady()

      expect(dialogs.alerts, '導覽不應被阻塞式對話框攔下').toEqual([])
    })
  })

  describe('編輯與保存（todoMain.vue:45-61）', () => {
    const editBtn = (w: Wrapper, i: number) => at(at(rows(w), i).findAll('button'), 0)
    const deleteBtn = (w: Wrapper, i: number) => at(at(rows(w), i).findAll('button'), 1)
    const editInput = (w: Wrapper, i: number) => at(rows(w), i).find('input[placeholder="請輸入編輯內容"]')

    it('點編輯後顯示輸入框，且帶入原本的內容', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')

      // 斷言行為（畫面切到編輯狀態），而非 store 內部欄位
      expect(editInput(w, 0).exists()).toBe(true)
      expect(asInput(editInput(w, 0)).value).toBe('Buy Milk')
      expect(at(rows(w), 0).find('p').exists()).toBe(false)
      // P1 修正後編輯狀態不再寫進領域資料
      expect(at(store.todoList, 0)).not.toHaveProperty('isEdit')
    })

    it('保存後寫回新內容並離開編輯狀態', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('Buy Oat Milk')
      await at(at(rows(w), 0).findAll('button'), 0).trigger('click')

      expect(at(store.todoList, 0).taskName).toBe('Buy Oat Milk')
      expect(editInput(w, 0).exists(), '應離開編輯狀態').toBe(false)
      expect(at(rows(w), 0).find('p').text()).toBe('Buy Oat Milk')
    })

    it('編輯內容清空時保存被擋下，仍留在編輯狀態', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('')
      await at(at(rows(w), 0).findAll('button'), 0).trigger('click')

      expect(editInput(w, 0).exists(), '仍留在編輯狀態').toBe(true)
      expect(at(store.todoList, 0).taskName).toBe('Buy Milk')
      expect(dialogs.alerts).toEqual(['請輸入編輯內容'])
    })

    it('已有項目在編輯中時，不能編輯另一個項目', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editBtn(w, 1).trigger('click')

      expect(editInput(w, 1).exists(), '第二筆不應進入編輯狀態').toBe(false)
      expect(dialogs.alerts).toEqual(['有待辦事項尚未保存，請先完成編輯'])
    })

    it('重新載入後回到閱讀狀態，原文字完好且清單未被鎖住（稽核 P1 已修正）', async () => {
      // 模擬「編輯中重新整理」：持久化的資料裡不再帶有編輯狀態，
      // 新掛載的元件一律從閱讀狀態開始。
      store.todoList = [makeTask('原本的內容', false, { id: '1' }), makeTask('另一筆', false, { id: '2' })]
      const w = mountWith(todoMain, pinia, { router: testRouter() })

      // 原文字看得見，沒有殘留的空白輸入框
      expect(at(rows(w), 0).find('p').text()).toBe('原本的內容')
      expect(w.find('input[placeholder="請輸入編輯內容"]').exists()).toBe(false)

      // 任何一筆都能正常進入編輯
      await editBtn(w, 1).trigger('click')
      expect(asInput(editInput(w, 1)).value).toBe('另一筆')
      expect(dialogs.alerts).toEqual([])
    })

    it('刪除編輯中的項目會一併結束編輯狀態', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await deleteBtn(w, 0).trigger('click')

      // 不應殘留編輯狀態把其他項目鎖住
      expect(w.find('input[placeholder="請輸入編輯內容"]').exists()).toBe(false)
      await editBtn(w, 0).trigger('click')
      expect(dialogs.alerts).toEqual([])
    })

    it('刪除依 id 移除項目', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(store.todoList.map((t) => t.id)).toEqual(['2', '3'])
    })

    it('[現況] id 碰撞時，刪除一筆會連帶刪掉另一筆（稽核 P17 的實際危害）', async () => {
      // Date.now() 當 id，同毫秒新增的兩筆會拿到相同的值
      store.todoList = [
        makeTask('同毫秒 A', false, { id: '1700000000000' }),
        makeTask('同毫秒 B', false, { id: '1700000000000' }),
        makeTask('不相干', false, { id: '1700000000001' }),
      ]
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(store.todoList.map((t) => t.taskName)).toEqual(['不相干'])
    })

    it('[現況] 刪除不需要任何確認（稽核 P16）', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(dialogs.confirms).toEqual([])
      expect(store.todoList).toHaveLength(2)
    })
  })

  describe('完成狀態勾選（todoMain.vue:17）', () => {
    it('勾選 checkbox 會更新該項目的 isCompleted', async () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      await at(rows(w), 0).find('input[type="checkbox"]').setValue(true)
      expect(at(store.todoList, 0).isCompleted).toBe(true)
    })

    it('已完成的項目加上刪除線', () => {
      seed()
      const w = mountWith(todoMain, pinia, { router: testRouter() })
      expect(at(rows(w), 1).find('p').classes()).toContain('line-through')
      expect(at(rows(w), 0).find('p').classes()).not.toContain('line-through')
    })
  })
})
