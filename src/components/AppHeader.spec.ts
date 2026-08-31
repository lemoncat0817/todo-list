import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import AppHeader from '@/components/AppHeader.vue'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import type { Pinia } from 'pinia'
import {
  freshPinia,
  mountWith,
  stubDialogs,
  makeTask,
  at,
  asInput,
  testRouter,
  type Wrapper,
  type DialogLog,
} from '@/test/helpers'
import type { Router } from 'vue-router'
import { useCollectionsStore } from '@/stores/collections'
import { addDays, today } from '@/domain/dates'

/**
 * 鎖定 AppHeader.vue 的既有行為。
 * 標示 [現況] 的案例是刻意記錄「目前就是這樣」，含稽核報告指出的缺陷；
 * 之後的階段修正時這些測試會轉紅，那正是我們要的改變證明。
 */
describe('AppHeader.vue', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTasksStore>
  let ui: ReturnType<typeof useUiStore>
  let dialogs: DialogLog
  // 標題與新增時要繼承的脈絡都從網址推導，所以這個元件現在需要 router
  let router: Router

  beforeEach(() => {
    pinia = freshPinia()
    store = useTasksStore()
    ui = useUiStore()
    // 元件測試針對已載入完成的狀態；載入流程由 db 層的測試負責。
    store.isLoading = false
    dialogs = stubDialogs()
    router = testRouter()
  })
  afterEach(() => vi.restoreAllMocks())

  const textInput = (w: Wrapper) => w.find('input[aria-label="新增代辦事項"]')
  const addButton = (w: Wrapper) => w.find('button[aria-label="新增"]')

  describe('addTask（AppHeader.vue:101-106）', () => {
    it('輸入內容後新增，並清空輸入框', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('寫測試')
      await addButton(w).trigger('click')

      expect(store.items).toHaveLength(1)
      expect(at(store.items, 0)).toMatchObject({
        taskName: '寫測試',
        isCompleted: false,
      })
      // P1 修正後不再把編輯狀態寫進領域資料
      expect(at(store.items, 0)).not.toHaveProperty('isEdit')
      expect(asInput(textInput(w)).value).toBe('')
    })

    it('空字串時新增鈕停用，不用 alert 事後責備', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      expect(addButton(w).attributes('disabled'), '按鈕應停用').toBeDefined()
      expect(store.items).toHaveLength(0)
      expect(dialogs.alerts, '不該再用阻塞式對話框').toEqual([])
    })

    it('只有空白字元時，v-model.trim 使其成為空字串，按鈕維持停用', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('    ')
      expect(addButton(w).attributes('disabled')).toBeDefined()
      expect(store.items).toHaveLength(0)
      expect(dialogs.alerts).toEqual([])
    })

    it('按下 Enter 也能新增', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('用 Enter 新增')
      await textInput(w).trigger('keyup.enter')

      expect(store.items).toHaveLength(1)
      expect(at(store.items, 0).taskName).toBe('用 Enter 新增')
    })

    it('id 改用 randomUUID，不再是時間戳（稽核 P17 已修正）', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('第一筆')
      await addButton(w).trigger('click')
      await textInput(w).setValue('第二筆')
      await addButton(w).trigger('click')

      const ids = store.items.map((t) => t.id)
      expect(ids).toHaveLength(2)
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      }
      expect(new Set(ids).size, '不同筆必須是不同 id').toBe(2)
    })

    it('新增時給定遞增的排序鍵', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      for (const name of ['一', '二', '三']) {
        await textInput(w).setValue(name)
        await addButton(w).trigger('click')
      }
      expect(store.items.map((t) => t.order)).toEqual([0, 1, 2])
    })
  })

  describe('快速新增：一行寫完一筆任務', () => {
    it('日期、優先度、專案、標籤一次解析，名稱只留下真正的內容', async () => {
      const collections = useCollectionsStore()
      const project = collections.addProject('工作')
      const tag = collections.addTag('公司')

      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('明天 交報告 p1 #工作 @公司')
      await addButton(w).trigger('click')

      const task = at(store.items, 0)
      expect(task.taskName, '語法片段不該留在名稱裡').toBe('交報告')
      expect(task.dueDate).toBe(addDays(today(), 1))
      expect(task.priority, 'p1 是最高，內部為 3').toBe(3)
      expect(task.projectId).toBe(project.id)
      expect(task.tagIds).toEqual([tag.id])
    })

    it('送出前就看得到解析結果，不用送出才知道猜對沒', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('明天 交報告 p1')

      const preview = w.find('[role="status"]')
      expect(preview.exists()).toBe(true)
      expect(preview.text()).toContain('交報告')
      expect(preview.text()).toContain('P1')
      expect(preview.text()).toContain(addDays(today(), 1))
    })

    it('沒有語法時不顯示預覽，也不動任何欄位', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('買牛奶')
      expect(w.find('[role="status"]').exists()).toBe(false)

      await addButton(w).trigger('click')
      expect(at(store.items, 0)).toMatchObject({ taskName: '買牛奶', dueDate: null, priority: 0 })
    })

    it('#專案 不存在時順手建立——預覽已經標示「新專案」，不算偷偷做事', async () => {
      const collections = useCollectionsStore()
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('交報告 #行銷 @新標籤')

      expect(w.find('[role="status"]').text()).toContain('新專案 行銷')
      await addButton(w).trigger('click')

      const project = collections.projects.find((p) => p.name === '行銷')
      const tag = collections.tags.find((t) => t.name === '新標籤')
      expect(project, '應已建立專案').toBeDefined()
      expect(at(store.items, 0).projectId).toBe(project?.id)
      expect(at(store.items, 0).tagIds).toEqual([tag?.id])
    })

    it('整句都是語法時退回原文，不會產生沒有名字的任務', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await textInput(w).setValue('明天')
      await addButton(w).trigger('click')

      expect(at(store.items, 0).taskName).toBe('明天')
      expect(at(store.items, 0).dueDate).toBeNull()
    })

    it('明確打出的日期蓋過檢視脈絡', async () => {
      await router.push('/today')
      const w = mountWith(AppHeader, pinia, { router })

      await textInput(w).setValue('在今天檢視新增')
      await addButton(w).trigger('click')
      expect(at(store.items, 0).dueDate, '沒指定就跟著檢視走').toBe(today())

      await textInput(w).setValue('明天 交報告')
      await addButton(w).trigger('click')
      expect(at(store.items, 1).dueDate, '打了明天就以明天為準').toBe(addDays(today(), 1))
    })
  })

  describe('isAll 全選 computed（AppHeader.vue:53-58, 108-113）', () => {
    const checkbox = (w: Wrapper) => w.find('input[type="checkbox"]')

    it('全部完成時為已勾選', () => {
      store.items = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(AppHeader, pinia, { router })
      expect(asInput(checkbox(w)).checked).toBe(true)
    })

    it('有任一未完成時為未勾選', () => {
      store.items = [makeTask('a', true), makeTask('b', false)]
      const w = mountWith(AppHeader, pinia, { router })
      expect(asInput(checkbox(w)).checked).toBe(false)
    })

    it('勾選時將全部標記為完成', async () => {
      store.items = [makeTask('a', false), makeTask('b', false)]
      const w = mountWith(AppHeader, pinia, { router })
      await checkbox(w).setValue(true)
      expect(store.items.every((t) => t.isCompleted)).toBe(true)
    })

    it('取消勾選時將全部標記為未完成', async () => {
      store.items = [makeTask('a', true), makeTask('b', true)]
      const w = mountWith(AppHeader, pinia, { router })
      await checkbox(w).setValue(false)
      expect(store.items.every((t) => !t.isCompleted)).toBe(true)
    })

    it('清單為空時全選框不顯示為已勾選（稽核 P13 已修正）', () => {
      const w = mountWith(AppHeader, pinia, { router })
      expect(store.items).toHaveLength(0)
      // [].every() 依規範回傳 true，所以要額外檢查長度，否則空清單會顯示為全部完成
      expect(checkbox(w).exists(), '空清單時整個全選框不渲染').toBe(false)
    })

    it('有項目時才渲染全選框，不再用 invisible 留一個看不見的控制項', () => {
      expect(mountWith(AppHeader, pinia, { router }).find('input[type="checkbox"]').exists()).toBe(false)
      store.items = [makeTask('a', false)]
      expect(mountWith(AppHeader, pinia, { router }).find('input[type="checkbox"]').exists()).toBe(true)
    })

    it('搜尋中隱藏全選框：它作用在全部任務，不是眼前的篩選結果，避免誤觸', async () => {
      store.items = [makeTask('a', false)]
      const w = mountWith(AppHeader, pinia, { router })
      expect(w.find('input[type="checkbox"]').exists()).toBe(true)

      ui.isSearch = true
      await w.vm.$nextTick()
      expect(w.find('input[type="checkbox"]').exists()).toBe(false)
    })
  })

  describe('searchMode 切換（AppHeader.vue:12-15, 72-76）', () => {
    const modeButton = (w: Wrapper) =>
    w.find(`button[aria-label="搜尋代辦事項"], button[aria-label="結束搜尋"]`)

    it('切換 isSearch，並以 aria-label 與 aria-pressed 表達狀態', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      expect(modeButton(w).attributes('aria-label')).toBe('搜尋代辦事項')
      expect(modeButton(w).attributes('aria-pressed')).toBe('false')

      await modeButton(w).trigger('click')
      expect(ui.isSearch).toBe(true)
      expect(modeButton(w).attributes('aria-label')).toBe('結束搜尋')
      expect(modeButton(w).attributes('aria-pressed')).toBe('true')
    })

    it('切換時清空 keyword', async () => {
      ui.isSearch = true
      ui.keyword = '既有關鍵字'
      const w = mountWith(AppHeader, pinia, { router })
      await modeButton(w).trigger('click')

      expect(ui.isSearch).toBe(false)
      expect(ui.keyword).toBe('')
    })

    it('搜尋模式下新增輸入框仍在，另外顯示搜尋輸入框（不再互相取代）', async () => {
      const w = mountWith(AppHeader, pinia, { router })
      await modeButton(w).trigger('click')

      expect(textInput(w).exists(), '搜尋不該頂掉新增輸入框').toBe(true)
      expect(w.find('input[aria-label="搜尋代辦事項"]').exists()).toBe(true)
    })

    it('關閉搜尋時搜尋輸入框整個不渲染，不佔版面', () => {
      const w = mountWith(AppHeader, pinia, { router })
      expect(w.find('input[aria-label="搜尋代辦事項"]').exists()).toBe(false)
    })

    it('關鍵字輸入會寫進 store', async () => {
      ui.isSearch = true
      const w = mountWith(AppHeader, pinia, { router })
      await w.find('input[aria-label="搜尋代辦事項"]').setValue('牛奶')
      expect(ui.keyword).toBe('牛奶')
    })
  })
})
