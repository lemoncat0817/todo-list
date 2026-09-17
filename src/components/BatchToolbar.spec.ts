import { describe, it, expect, beforeEach } from 'vitest'
import BatchToolbar from '@/components/BatchToolbar.vue'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useCollectionsStore } from '@/stores/collections'
import { freshPinia, mountWith } from '@/test/helpers'
import { today } from '@/domain/dates'

describe('BatchToolbar.vue — 批次操作工具列', () => {
  beforeEach(() => {
    freshPinia()
    useTasksStore().isLoading = false
  })

  it('渲染已選項目數量', () => {
    const pinia = freshPinia()
    const w = mountWith(BatchToolbar, pinia, { props: { count: 3 } })
    expect(w.text()).toContain('已選 3 項')
  })

  it('批次完成與取消完成，執行後清空選取', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const ui = useUiStore()

    const t1 = tasks.add('任務 1')
    const t2 = tasks.add('任務 2')
    ui.setSelection([t1.id, t2.id])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 2 } })

    // 點擊「完成」
    const completeBtn = w.findAll('button').find((b) => b.text() === '完成')
    expect(completeBtn).toBeDefined()
    await completeBtn?.trigger('click')

    expect(tasks.items.find((t) => t.id === t1.id)?.isCompleted).toBe(true)
    expect(tasks.items.find((t) => t.id === t2.id)?.isCompleted).toBe(true)
    expect(ui.selectedIds).toEqual([])

    // 再次選取並點擊「取消完成」
    ui.setSelection([t1.id])
    const uncompleteBtn = w.findAll('button').find((b) => b.text() === '取消完成')
    expect(uncompleteBtn).toBeDefined()
    await uncompleteBtn?.trigger('click')

    expect(tasks.items.find((t) => t.id === t1.id)?.isCompleted).toBe(false)
    expect(ui.selectedIds).toEqual([])
  })

  it('批次改期（今天、明天、清除日期）', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const ui = useUiStore()

    const t1 = tasks.add('改期測試')
    ui.setSelection([t1.id])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 1 } })

    // 點擊「今天」
    const todayBtn = w.findAll('button').find((b) => b.text() === '今天')
    await todayBtn?.trigger('click')
    expect(tasks.items.find((t) => t.id === t1.id)?.dueDate).toBe(today())
    expect(ui.selectedIds).toEqual([])

    // 點擊「清除日期」
    ui.setSelection([t1.id])
    const clearDateBtn = w.findAll('button').find((b) => b.text() === '清除日期')
    await clearDateBtn?.trigger('click')
    expect(tasks.items.find((t) => t.id === t1.id)?.dueDate).toBeNull()
    expect(ui.selectedIds).toEqual([])
  })

  it('批次設定優先度', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const ui = useUiStore()

    const t1 = tasks.add('優先度測試')
    ui.setSelection([t1.id])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 1 } })

    const prioSelect = w.find('#batch-priority')
    await prioSelect.setValue('3') // P1 (數值 3)
    await prioSelect.trigger('change')

    expect(tasks.items.find((t) => t.id === t1.id)?.priority).toBe(3)
    expect(ui.selectedIds).toEqual([])
  })

  it('批次移動到專案或未分類', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const ui = useUiStore()
    const collections = useCollectionsStore()

    const project = collections.addProject('目標專案')
    const t1 = tasks.add('移到專案測試')
    ui.setSelection([t1.id])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 1 } })

    const projectSelect = w.find('#batch-project')
    // 移動到專案
    await projectSelect.setValue(project.id)
    await projectSelect.trigger('change')
    expect(tasks.items.find((t) => t.id === t1.id)?.projectId).toBe(project.id)
    expect(ui.selectedIds).toEqual([])

    // 移動到未分類 (none)
    ui.setSelection([t1.id])
    await projectSelect.setValue('none')
    await projectSelect.trigger('change')
    expect(tasks.items.find((t) => t.id === t1.id)?.projectId).toBeNull()
    expect(ui.selectedIds).toEqual([])
  })

  it('批次刪除選取任務', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const ui = useUiStore()

    const t1 = tasks.add('即將刪除 1')
    const t2 = tasks.add('即將刪除 2')
    ui.setSelection([t1.id, t2.id])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 2 } })

    const removeBtn = w.findAll('button').find((b) => b.text() === '刪除')
    await removeBtn?.trigger('click')

    expect(tasks.items.some((t) => t.id === t1.id)).toBe(false)
    expect(tasks.items.some((t) => t.id === t2.id)).toBe(false)
    expect(ui.selectedIds).toEqual([])
  })

  it('取消選取按鈕可清空 selection', async () => {
    const pinia = freshPinia()
    const ui = useUiStore()
    ui.setSelection(['a', 'b'])

    const w = mountWith(BatchToolbar, pinia, { props: { count: 2 } })

    const cancelBtn = w.findAll('button').find((b) => b.text() === '取消選取')
    await cancelBtn?.trigger('click')

    expect(ui.selectedIds).toEqual([])
  })
})
