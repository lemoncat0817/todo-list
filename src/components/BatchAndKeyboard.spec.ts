import { describe, it, expect, beforeEach } from 'vitest'
import type { Pinia } from 'pinia'
import TaskListView from '@/components/TaskListView.vue'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useHistoryStore } from '@/stores/history'
import { freshPinia, mountWith, makeTask, at, testRouter, type Wrapper } from '@/test/helpers'
import { addDays, today } from '@/domain/dates'

/**
 * 批次操作與鍵盤導航。
 *
 * 兩個重點：整批只算一個復原命令（要按二十次 Ctrl+Z 才回得去等於沒有復原），
 * 以及鍵盤走的是真正的 DOM 焦點——自訂的「目前選取索引」螢幕閱讀器讀不到，
 * 也會跟 Tab 鍵走出兩條不同的路徑。
 */
describe('批次操作與鍵盤導航', () => {
  let pinia: Pinia
  let store: ReturnType<typeof useTasksStore>
  let ui: ReturnType<typeof useUiStore>

  beforeEach(() => {
    pinia = freshPinia()
    store = useTasksStore()
    ui = useUiStore()
    store.isLoading = false
    store.items = [
      makeTask('一', false, { id: '1', order: 1 }),
      makeTask('二', false, { id: '2', order: 2 }),
      makeTask('三', false, { id: '3', order: 3 }),
    ]
  })

  const mountList = () =>
    mountWith(TaskListView, pinia, { props: { viewKind: 'all' }, router: testRouter() })
  const rows = (w: Wrapper) => w.findAll('li[data-test=task-row]')
  const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))

  it('沒有選取時不顯示批次列，也不多出一排核取方塊', () => {
    const w = mountList()
    expect(w.find('[aria-label="批次操作"]').exists()).toBe(false)
    expect(at(rows(w), 0).findAll('input[type=checkbox]'), '平時每列只有一個核取方塊').toHaveLength(1)
  })

  it('Ctrl + 點擊加入選取，批次列隨即出現', async () => {
    const w = mountList()
    await at(rows(w), 0).trigger('click', { ctrlKey: true })

    expect(ui.selectedIds).toEqual(['1'])
    expect(w.find('[aria-label="批次操作"]').text()).toContain('已選 1 項')
    expect(at(rows(w), 0).findAll('input[type=checkbox]'), '選取模式下才多一個').toHaveLength(2)
  })

  it('點在控制項上時不觸發選取——那時使用者要的是那個控制項', async () => {
    const w = mountList()
    await at(rows(w), 0).find('input[type=checkbox]').trigger('click', { ctrlKey: true })
    expect(ui.selectedIds).toEqual([])
  })

  it('j / k 以真正的 DOM 焦點在列之間移動', async () => {
    const w = mountList()
    document.body.appendChild(w.element)

    press('j')
    await w.vm.$nextTick()
    expect((document.activeElement as HTMLElement)?.dataset.taskId).toBe('1')

    press('j')
    expect((document.activeElement as HTMLElement)?.dataset.taskId).toBe('2')

    press('k')
    expect((document.activeElement as HTMLElement)?.dataset.taskId).toBe('1')
  })

  it('x 把聚焦的那一列加入選取', async () => {
    const w = mountList()
    document.body.appendChild(w.element)

    press('j')
    press('x')
    await w.vm.$nextTick()
    expect(ui.selectedIds).toEqual(['1'])
  })

  it('e 讓聚焦的那一列進入編輯狀態', async () => {
    const w = mountList()
    document.body.appendChild(w.element)

    press('j')
    press('e')
    await w.vm.$nextTick()
    expect(w.find('input[aria-label^="編輯「一」"]').exists()).toBe(true)
  })

  it('批次改期只推一個復原命令', async () => {
    const history = useHistoryStore()
    const w = mountList()
    ui.setSelection(['1', '2'])
    await w.vm.$nextTick()
    history.clear()

    const tomorrow = w
      .findAll('[aria-label="批次操作"] button')
      .filter((b) => b.text() === '明天')
    await at(tomorrow, 0).trigger('click')

    expect(store.items.filter((t) => t.dueDate === addDays(today(), 1))).toHaveLength(2)
    expect(history.depth, '整批算一個').toBe(1)
    expect(ui.selectedIds, '做完就清空選取，避免下一個動作誤觸同一批').toEqual([])
  })

  it('批次刪除後可一次復原', async () => {
    const history = useHistoryStore()
    const w = mountList()
    ui.setSelection(['1', '2'])
    await w.vm.$nextTick()

    const remove = w.findAll('[aria-label="批次操作"] button').filter((b) => b.text() === '刪除')
    await at(remove, 0).trigger('click')
    expect(store.items.map((t) => t.id)).toEqual(['3'])

    await history.undo()
    expect(store.items).toHaveLength(3)
  })

  it('換檢視時清空選取——看不見的選取被批次刪除是最糟的情況', async () => {
    const w = mountList()
    ui.setSelection(['1'])
    await w.setProps({ viewKind: 'completed' })
    expect(ui.selectedIds).toEqual([])
  })
})
