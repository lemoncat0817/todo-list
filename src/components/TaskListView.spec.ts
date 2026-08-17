import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import TaskListView from '@/components/TaskListView.vue'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import type { Pinia } from 'pinia'
import type { TaskFilter } from '@/domain/filtering'
import {
  freshPinia, mountWith, stubDialogs, makeTask, at, asInput, testRouter,
  type Wrapper, type DialogLog,
} from '@/test/helpers'

/**
 * 鎖定 TaskListView.vue 的既有行為。
 * 標示 [現況] 的案例記錄稽核報告指出的缺陷，修正後應轉紅。
 */
describe('TaskListView.vue', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTasksStore>
  let ui: ReturnType<typeof useUiStore>
  let dialogs: DialogLog

  beforeEach(() => {
    pinia = freshPinia()
    store = useTasksStore()
    ui = useUiStore()
    // 元件測試針對已載入完成的狀態；載入流程由 db 層的測試負責。
    store.isLoading = false
    dialogs = stubDialogs()
  })
  afterEach(() => vi.restoreAllMocks())

  const rows = (w: Wrapper) => w.findAll('li')
  const names = (w: Wrapper) => rows(w).map((r) => r.find('p').text())
  const seed = () => {
    store.items = [
      makeTask('Buy Milk', false, { id: '1' }),
      makeTask('buy milk', true, { id: '2' }),
      makeTask('寫測試', false, { id: '3' }),
    ]
  }
  describe('taskList 過濾（由路由 filter prop 驅動）', () => {
    it('filter=all 顯示全部', () => {
      seed()
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk', '寫測試'])
    })

    it('filter 未指定時預設為 all', () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk', '寫測試'])
    })

    it('filter=active 只顯示未完成', () => {
      seed()
      const w = mountWith(TaskListView, pinia, { props: { filter: 'active' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', '寫測試'])
    })

    it('filter=completed 只顯示已完成', () => {
      seed()
      const w = mountWith(TaskListView, pinia, { props: { filter: 'completed' }, router: testRouter() })
      expect(names(w)).toEqual(['buy milk'])
    })

    it('keyword 疊加 filter=all', () => {
      seed()
      ui.keyword = 'buy'
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk'])
    })

    it('keyword 疊加 filter=active', () => {
      seed()
      ui.keyword = 'i'
      const w = mountWith(TaskListView, pinia, { props: { filter: 'active' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk'])
    })

    it('keyword 疊加 filter=completed', () => {
      seed()
      ui.keyword = 'i'
      const w = mountWith(TaskListView, pinia, { props: { filter: 'completed' }, router: testRouter() })
      expect(names(w)).toEqual(['buy milk'])
    })

    it('搜尋大小寫不敏感（稽核 P4 已修正）', () => {
      seed()
      ui.keyword = 'buy'
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk', 'buy milk'])
    })

    it('全形關鍵字可命中半形內容（稽核 P4 已修正）', () => {
      store.items = [makeTask('Buy Milk', false, { id: '1' })]
      ui.keyword = 'ＢＵＹ'
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['Buy Milk'])
    })

    it.each(['bogus', '', null, undefined, 7])(
      'filter=%s 這類非預期值一律退回完整清單，不再是 undefined（稽核 P3）',
      (bad) => {
        seed()
        const w = mountWith(TaskListView, pinia, {
          props: { filter: bad as unknown as TaskFilter },
          router: testRouter(),
        })
        expect(rows(w)).toHaveLength(3)
      },
    )
  })

  describe('子任務不出現在頂層清單', () => {
    it('只顯示 parentId 為 null 的項目', () => {
      store.items = [
        makeTask('父項', false, { id: 'p', order: 0 }),
        makeTask('子項', false, { id: 'c', parentId: 'p', order: 1 }),
        makeTask('另一個頂層', false, { id: 'x', order: 2 }),
      ]
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w), '子任務應跟著父項呈現，不佔頂層一列').toEqual(['父項', '另一個頂層'])
    })

    it('清單依 order 排序而非插入順序', () => {
      store.items = [
        makeTask('第三', false, { id: 'c', order: 30 }),
        makeTask('第一', false, { id: 'a', order: 10 }),
        makeTask('第二', false, { id: 'b', order: 20 }),
      ]
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      expect(names(w)).toEqual(['第一', '第二', '第三'])
    })
  })

  describe('分頁導覽（改為路由連結）', () => {
    const tabs = (w: Wrapper) => w.findAll('nav a')

    it('三個分頁指向對應的路由', () => {
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      // 分頁標籤後面帶數量，比對開頭即可
      // 分頁標籤後面帶該分頁的項目數，比對時去掉
      expect(tabs(w).map((a) => a.text().replace(/\s*\d+$/, ''))).toEqual([
        '全部',
        '未完成',
        '完成',
      ])
      expect(tabs(w).map((a) => a.attributes('href'))).toEqual(['/', '/active', '/completed'])
    })

    it('目前所在的分頁標上 aria-current="page"', () => {
      const w = mountWith(TaskListView, pinia, {
        props: { filter: 'completed' },
        router: testRouter(),
      })
      const current = tabs(w).map((a) => a.attributes('aria-current'))
      expect(current).toEqual([undefined, undefined, 'page'])
    })

    it('分頁是真正的連結，鍵盤可聚焦（稽核 P6 的一部分）', () => {
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router: testRouter() })
      for (const a of tabs(w)) {
        expect(a.element.tagName).toBe('A')
        expect(a.attributes('href')).toBeTruthy()
      }
    })

    it('清單為空時仍可切換分頁，不再跳 alert 攔截', async () => {
      const router = testRouter()
      const w = mountWith(TaskListView, pinia, { props: { filter: 'all' }, router })
      await at(tabs(w), 1).trigger('click')
      await router.isReady()

      expect(dialogs.alerts, '導覽不應被阻塞式對話框攔下').toEqual([])
    })
  })

  describe('編輯與保存（TaskListView.vue:45-61）', () => {
    const editBtn = (w: Wrapper, i: number) => at(rows(w), i).find('button[aria-label^="編輯"]')
    const deleteBtn = (w: Wrapper, i: number) => at(rows(w), i).find('button[aria-label^="刪除"]')
    const editInput = (w: Wrapper, i: number) => at(rows(w), i).find('input[aria-label^="編輯"]')

    it('點編輯後顯示輸入框，且帶入原本的內容', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')

      // 斷言行為（畫面切到編輯狀態），而非 store 內部欄位
      expect(editInput(w, 0).exists()).toBe(true)
      expect(asInput(editInput(w, 0)).value).toBe('Buy Milk')
      expect(at(rows(w), 0).find('p').exists()).toBe(false)
      // P1 修正後編輯狀態不再寫進領域資料
      expect(at(store.items, 0)).not.toHaveProperty('isEdit')
    })

    it('保存後寫回新內容並離開編輯狀態', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('Buy Oat Milk')
      await at(rows(w), 0).find('button[aria-label^="保存"]').trigger('click')

      expect(at(store.items, 0).taskName).toBe('Buy Oat Milk')
      expect(editInput(w, 0).exists(), '應離開編輯狀態').toBe(false)
      expect(at(rows(w), 0).find('p').text()).toBe('Buy Oat Milk')
    })

    it('編輯內容為空時保存被忽略，仍留在編輯狀態且不跳對話框', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editInput(w, 0).setValue('')
      await at(rows(w), 0).find('button[aria-label^="保存"]').trigger('click')

      expect(editInput(w, 0).exists(), '仍留在編輯狀態').toBe(true)
      expect(at(store.items, 0).taskName).toBe('Buy Milk')
      // 空白不是有效名稱，直接忽略即可 —— 不需要跳對話框責備使用者
      expect(dialogs.alerts).toEqual([])
    })

    it('編輯中點另一項會直接切過去，不用對話框攔截', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await editBtn(w, 1).trigger('click')

      // 舊版會跳「有待辦事項尚未保存」把使用者擋住。
      // 未保存的編輯本來就只是暫存，切走等同放棄，不值得用阻塞式對話框打斷。
      expect(editInput(w, 1).exists(), '第二筆進入編輯狀態').toBe(true)
      expect(editInput(w, 0).exists(), '第一筆離開編輯狀態').toBe(false)
      expect(dialogs.alerts).toEqual([])
    })

    it('重新載入後回到閱讀狀態，原文字完好且清單未被鎖住（稽核 P1 已修正）', async () => {
      // 模擬「編輯中重新整理」：持久化的資料裡不再帶有編輯狀態，
      // 新掛載的元件一律從閱讀狀態開始。
      store.items = [makeTask('原本的內容', false, { id: '1' }), makeTask('另一筆', false, { id: '2' })]
      const w = mountWith(TaskListView, pinia, { router: testRouter() })

      // 原文字看得見，沒有殘留的空白輸入框
      expect(at(rows(w), 0).find('p').text()).toBe('原本的內容')
      expect(w.find('input[aria-label^="編輯"]').exists()).toBe(false)

      // 任何一筆都能正常進入編輯
      await editBtn(w, 1).trigger('click')
      expect(asInput(editInput(w, 1)).value).toBe('另一筆')
      expect(dialogs.alerts).toEqual([])
    })

    it('刪除編輯中的項目會一併結束編輯狀態', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await editBtn(w, 0).trigger('click')
      await deleteBtn(w, 0).trigger('click')

      // 不應殘留編輯狀態把其他項目鎖住
      expect(w.find('input[aria-label^="編輯"]').exists()).toBe(false)
      await editBtn(w, 0).trigger('click')
      expect(dialogs.alerts).toEqual([])
    })

    it('刪除依 id 移除項目', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(store.items.map((t) => t.id)).toEqual(['2', '3'])
    })

    it('[現況] id 碰撞時，刪除一筆會連帶刪掉另一筆（稽核 P17 的實際危害）', async () => {
      // Date.now() 當 id，同毫秒新增的兩筆會拿到相同的值
      store.items = [
        makeTask('同毫秒 A', false, { id: '1700000000000' }),
        makeTask('同毫秒 B', false, { id: '1700000000000' }),
        makeTask('不相干', false, { id: '1700000000001' }),
      ]
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(store.items.map((t) => t.taskName)).toEqual(['不相干'])
    })

    it('[現況] 刪除不需要任何確認（稽核 P16）', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await deleteBtn(w, 0).trigger('click')

      expect(dialogs.confirms).toEqual([])
      expect(store.items).toHaveLength(2)
    })
  })

  describe('完成狀態勾選（TaskListView.vue:17）', () => {
    it('勾選 checkbox 會更新該項目的 isCompleted', async () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      await at(rows(w), 0).find('input[type="checkbox"]').setValue(true)
      expect(at(store.items, 0).isCompleted).toBe(true)
    })

    it('已完成的項目加上刪除線', () => {
      seed()
      const w = mountWith(TaskListView, pinia, { router: testRouter() })
      expect(at(rows(w), 1).find('p').classes()).toContain('line-through')
      expect(at(rows(w), 0).find('p').classes()).not.toContain('line-through')
    })
  })
})
