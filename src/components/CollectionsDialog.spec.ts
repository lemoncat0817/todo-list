import { describe, it, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import CollectionsDialog from '@/components/CollectionsDialog.vue'
import { useCollectionsStore } from '@/stores/collections'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

describe('CollectionsDialog.vue — 完整管理功能', () => {
  beforeEach(() => {
    freshPinia()
    useTasksStore().isLoading = false
  })

  describe('分頁切換 (Tabs)', () => {
    it('預設開啟專案分頁，點擊標籤與篩選器可自由切換', async () => {
      const router = testRouter()
      const w = mountWith(CollectionsDialog, freshPinia(), { props: { open: true }, router })

      const tabProjects = w.find('#tab-projects')
      const tabTags = w.find('#tab-tags')
      const tabFilters = w.find('#tab-filters')

      expect(tabProjects.attributes('aria-selected')).toBe('true')
      expect(tabTags.attributes('aria-selected')).toBe('false')

      // 切換至標籤
      await tabTags.trigger('click')
      expect(tabTags.attributes('aria-selected')).toBe('true')
      expect(tabProjects.attributes('aria-selected')).toBe('false')

      // 切換至篩選器
      await tabFilters.trigger('click')
      expect(tabFilters.attributes('aria-selected')).toBe('true')
      expect(tabTags.attributes('aria-selected')).toBe('false')
    })

    it('支援透過 target prop 指定初始分頁', async () => {
      const router = testRouter()
      const w = mountWith(CollectionsDialog, freshPinia(), {
        props: { open: true, target: 'filters' },
        router,
      })

      expect(w.find('#tab-filters').attributes('aria-selected')).toBe('true')
    })
  })

  describe('專案管理 (Projects)', () => {
    it('新增專案：輸入名稱建立，若同名則顯示錯誤並禁用建立按鈕', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true }, router })

      const input = w.find('#new-project')
      await input.setValue('工作任務')
      expect(w.text()).not.toContain('已有相同名稱的專案')

      // 點擊建立
      const submitBtn = w.find('#panel-projects button.bg-accent')
      await submitBtn.trigger('click')
      await flushPromises()

      expect(collections.projects.some((p) => p.name === '工作任務')).toBe(true)
      expect((w.find('#new-project').element as HTMLInputElement).value).toBe('')

      // 再次輸入相同名稱
      await input.setValue('工作任務')
      expect(w.text()).toContain('已有相同名稱的專案')
      expect(submitBtn.attributes('disabled')).toBeDefined()
    })

    it('重新命名專案：輸入新名稱後觸發 change，若為空字串則不變更並還原', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const p = collections.addProject('原始名稱')
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true }, router })

      const nameInput = w.find(`#project-name-${p.id}`)

      // 重新命名
      await nameInput.setValue('修改後名稱')
      await nameInput.trigger('change')
      expect(collections.projects.find((item) => item.id === p.id)?.name).toBe('修改後名稱')

      // 輸入空字串，應還原
      await nameInput.setValue('   ')
      await nameInput.trigger('change')
      expect(collections.projects.find((item) => item.id === p.id)?.name).toBe('修改後名稱')
    })

    it('變更專案顏色：選擇新顏色觸發 recolor', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const p = collections.addProject('專案顏色測試')
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true }, router })

      const select = w.find(`#project-color-${p.id}`)
      await select.setValue('#15803d')
      await select.trigger('change')

      expect(collections.projects.find((item) => item.id === p.id)?.color).toBe('#15803d')
    })

    it('刪除專案：若當前路由正在該專案，刪除後應跳轉回 /today', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const p = collections.addProject('即將刪除')
      const router = testRouter()
      await router.push(`/project/${p.id}`)

      const w = mountWith(CollectionsDialog, pinia, { props: { open: true }, router })
      const deleteBtn = w.find(`button[aria-label="刪除專案「${p.name}」"]`)
      await deleteBtn.trigger('click')
      await flushPromises()

      expect(collections.projects.some((item) => item.id === p.id)).toBe(false)
      expect(router.currentRoute.value.path).toBe('/today')
    })
  })

  describe('標籤管理 (Tags)', () => {
    it('新增標籤、同名防呆與刪除標籤導向', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true, target: 'tags' }, router })

      const input = w.find('#new-tag')
      await input.setValue('緊急')
      const submitBtn = w.find('#panel-tags button.bg-accent')
      await submitBtn.trigger('click')
      await flushPromises()

      const created = collections.tags.find((t) => t.name === '緊急')
      expect(created).toBeDefined()

      // 同名防呆
      await input.setValue('緊急')
      expect(w.text()).toContain('已有相同名稱的標籤')

      // 變更標籤名稱與顏色
      if (created) {
        const nameInput = w.find(`#tag-name-${created.id}`)
        await nameInput.setValue('超緊急')
        await nameInput.trigger('change')
        expect(collections.tags.find((t) => t.id === created.id)?.name).toBe('超緊急')

        const colorSelect = w.find(`#tag-color-${created.id}`)
        await colorSelect.setValue('#dc2626')
        await colorSelect.trigger('change')
        expect(collections.tags.find((t) => t.id === created.id)?.color).toBe('#dc2626')

        // 刪除標籤
        await router.push(`/label/${created.id}`)
        const deleteBtn = w.find(`button[aria-label="刪除標籤「超緊急」"]`)
        await deleteBtn.trigger('click')
        await flushPromises()

        expect(collections.tags.some((t) => t.id === created.id)).toBe(false)
        expect(router.currentRoute.value.path).toBe('/today')
      }
    })
  })

  describe('自訂篩選器管理 (Filters)', () => {
    it('快速填入範本、語法錯誤提示與建立篩選器', async () => {
      const pinia = freshPinia()
      const collections = useCollectionsStore()
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true, target: 'filters' }, router })

      // 點擊第一個快速填入範本按鈕
      const presetBtn = w.find('#panel-filters button.rounded-full')
      await presetBtn.trigger('click')
      await flushPromises()

      const queryInput = w.find('#new-filter-query')
      expect((queryInput.element as HTMLInputElement).value).not.toBe('')

      // 刻意輸入錯誤語法
      await queryInput.setValue('& | 錯誤條件')
      expect(w.text()).toContain('這裡應該是一個條件，不是運算子')

      // 輸入有效篩選條件與名稱
      const nameInput = w.find('#new-filter-name')
      await nameInput.setValue('今天的高優先任務')
      await queryInput.setValue('今天 & p1')
      await flushPromises()

      expect(w.text()).not.toContain('這裡應該是一個條件，不是運算子')

      // 點擊建立篩選器
      const createBtn = w.find('#panel-filters button.bg-accent')
      expect(createBtn.attributes('disabled')).toBeUndefined()
      await createBtn.trigger('click')
      await flushPromises()

      const created = collections.filters.find((f) => f.name === '今天的高優先任務')
      expect(created).toBeDefined()
      expect(created?.query).toBe('今天 & p1')

      // 刪除篩選器
      if (created) {
        const deleteBtn = w.find(`button[aria-label="刪除篩選器「今天的高優先任務」"]`)
        await deleteBtn.trigger('click')
        await flushPromises()
        expect(collections.filters.some((f) => f.id === created.id)).toBe(false)
      }
    })

    it('在篩選器輸入框中操作鍵盤 ArrowDown / Enter 支援自動建議補全', async () => {
      const pinia = freshPinia()
      const router = testRouter()
      const w = mountWith(CollectionsDialog, pinia, { props: { open: true, target: 'filters' }, router })

      const queryInput = w.find('#new-filter-query')
      await queryInput.trigger('focus')
      await queryInput.setValue('今')
      await queryInput.trigger('input')
      await flushPromises()

      // 按下方向鍵選擇第一個建議並按 Enter 套用
      await queryInput.trigger('keydown', { key: 'ArrowDown' })
      await queryInput.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect((queryInput.element as HTMLInputElement).value).toContain('今天')
    })
  })

  describe('對話框關閉 (Close)', () => {
    it('點擊關閉按鈕觸發 close 事件', async () => {
      const router = testRouter()
      const w = mountWith(CollectionsDialog, freshPinia(), { props: { open: true }, router })

      const closeBtn = w.findAll('button').find((b) => b.text() === '關閉')
      expect(closeBtn).toBeDefined()
      await closeBtn?.trigger('click')

      expect(w.emitted('close')).toBeTruthy()
    })
  })
})
