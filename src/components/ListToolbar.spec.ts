import { describe, it, expect } from 'vitest'
import ListToolbar from '@/components/ListToolbar.vue'
import { freshPinia, mountWith, makeTask, testRouter } from '@/test/helpers'
import { useTasksStore } from '@/stores/tasks'

/**
 * 只驗證這次新增的「依負責人」分組選項——排序/其餘分組選項/儲存篩選器
 * 等既有行為沒有專屬測試檔，維持現況不在這裡順手補齊。
 *
 * isSyncConfigured 為 true 的情境見 ListToolbar.assignee.spec.ts（同一個
 * vi.mock 檔案層級生效的坑，見 DataDialog.spec.ts 系列的說明）。
 */
describe('ListToolbar.vue — 依負責人分組（isSyncConfigured 為 false）', () => {
  it('分組選單裡不會出現「依負責人」', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, {
      props: { viewKind: 'all', query: null },
      router: testRouter(),
    })
    const options = w.find('#group-by').findAll('option').map((o) => o.text())
    expect(options).not.toContain('分組：負責人')
  })
})

describe('ListToolbar.vue — 清空已完成', () => {
  it('viewKind 不是 completed 時不顯示清空已完成按鈕', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, {
      props: { viewKind: 'all', query: null },
      router: testRouter(),
    })
    expect(w.find('button[data-test=clear-completed]').exists()).toBe(false)
  })

  it('viewKind 為 completed 時顯示按鈕，無已完成項目時停用', () => {
    const pinia = freshPinia()
    const tasks = useTasksStore(pinia)
    tasks.items = [makeTask('todo', false)]
    const w = mountWith(ListToolbar, pinia, {
      props: { viewKind: 'completed', query: null },
      router: testRouter(),
    })

    const btn = w.find('button[data-test=clear-completed]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('viewKind 為 completed 且有已完成項目時可點擊清除', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore(pinia)
    tasks.items = [
      makeTask('done-1', true, { id: '1' }),
      makeTask('todo-1', false, { id: '2' }),
    ]
    const w = mountWith(ListToolbar, pinia, {
      props: { viewKind: 'completed', query: null },
      router: testRouter(),
    })

    const btn = w.find('button[data-test=clear-completed]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()

    await btn.trigger('click')
    expect(tasks.items.map((t) => t.id)).toEqual(['2'])
  })
})

