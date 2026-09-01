import { describe, it, expect, beforeEach } from 'vitest'
import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import CommandPalette from '@/components/CommandPalette.vue'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useUiStore } from '@/stores/ui'
import { freshPinia, mountWith, makeTask, testRouter, at, type Wrapper } from '@/test/helpers'

/**
 * 命令面板把「跳轉」與「動作」放在同一個清單裡：先決定「這是導覽還是操作」
 * 是實作的分類，不是使用者腦中的分類。
 */
describe('CommandPalette.vue', () => {
  let pinia: Pinia
  let router: Router
  let tasks: ReturnType<typeof useTasksStore>
  let collections: ReturnType<typeof useCollectionsStore>
  let ui: ReturnType<typeof useUiStore>

  beforeEach(() => {
    pinia = freshPinia()
    router = testRouter()
    tasks = useTasksStore()
    collections = useCollectionsStore()
    ui = useUiStore()
    tasks.isLoading = false
  })

  const mountPalette = () =>
    mountWith(CommandPalette, pinia, { props: { open: true }, router })
  const options = (w: Wrapper) => w.findAll('[role="option"]')
  const setQuery = async (w: Wrapper, value: string) => {
    await w.find('input[role="combobox"]').setValue(value)
  }

  it('空查詢時列出檢視與動作，但不列出任務', async () => {
    tasks.items = [makeTask('某個任務', false)]
    const w = mountPalette()
    await w.vm.$nextTick()

    const text = w.text()
    expect(text).toContain('今天')
    expect(text).toContain('切換主題')
    expect(text, '幾百筆任務會把面板變成另一份清單').not.toContain('某個任務')
  })

  it('打字時同時搜尋檢視、專案、標籤與任務', async () => {
    collections.addProject('工作專案')
    tasks.items = [makeTask('工作報告', false)]
    const w = mountPalette()
    await setQuery(w, '工作')

    const labels = options(w).map((o) => o.text())
    expect(labels.some((l) => l.includes('工作專案'))).toBe(true)
    expect(labels.some((l) => l.includes('工作報告'))).toBe(true)
  })

  it('方向鍵移動選取，兩端循環', async () => {
    const w = mountPalette()
    const input = w.find('input[role="combobox"]')
    await w.vm.$nextTick()

    expect(at(options(w), 0).attributes('aria-selected')).toBe('true')
    await input.trigger('keydown.down')
    expect(at(options(w), 1).attributes('aria-selected')).toBe('true')

    // 從第一項往上應該跳到最後一項——長清單的最後一項一步就到得了
    await input.trigger('keydown.up')
    await input.trigger('keydown.up')
    const last = options(w).length - 1
    expect(at(options(w), last).attributes('aria-selected')).toBe('true')
  })

  it('Enter 執行選取的指令並關閉面板', async () => {
    const w = mountPalette()
    await setQuery(w, '即將到來')
    await w.find('input[role="combobox"]').trigger('keydown.enter')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/upcoming')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('選任務時開啟它的詳情', async () => {
    tasks.items = [makeTask('要看細節的', false, { id: 't1' })]
    const w = mountPalette()
    await setQuery(w, '要看細節的')
    await at(options(w), 0).trigger('click')

    expect(ui.detailTaskId).toBe('t1')
  })

  it('存過的篩選器也是可跳轉的項目，並顯示它的查詢', async () => {
    collections.addFilter('要事', 'today & p1')
    const w = mountPalette()
    await setQuery(w, '要事')

    expect(at(options(w), 0).text()).toContain('today & p1')
  })

  it('找不到時說明找不到什麼，而不是留一片空白', async () => {
    const w = mountPalette()
    await setQuery(w, '絕對不存在的東西')
    expect(options(w)).toHaveLength(0)
    expect(w.text()).toContain('找不到「絕對不存在的東西」')
  })
})
