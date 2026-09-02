import { describe, it, expect } from 'vitest'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

/**
 * 只驗證這次新增的「指派給」欄位——其餘既有欄位（名稱、備註、專案、
 * 標籤、重複規則……）沒有專屬測試檔，維持現況不在這裡順手補齊。
 *
 * 這支檔案跑在 isSyncConfigured 為 false（測試環境預設值）的情境：
 * 指派欄位整段不該出現，而且既有任務原本存的 assigneeId 在儲存時
 * 不能被靜默清掉——isSyncConfigured 為 true 的情境見
 * TaskDetailForm.assignee.spec.ts（同一個 vi.mock 檔案層級生效的坑，
 * 見 DataDialog.spec.ts／DataDialog.push.spec.ts 的說明，這裡沿用同一個
 * 拆檔模式）。
 */
describe('TaskDetailForm.vue — 指派給（isSyncConfigured 為 false）', () => {
  it('沒有設定同步時，指派欄位不顯示', () => {
    const pinia = freshPinia()
    const task = makeTask('任務', false, { assigneeId: null })
    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    expect(w.text()).not.toContain('指派給')
  })

  it('既有的 assigneeId 在儲存時原封不動，不會因為欄位沒顯示就被清空', async () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    // 情境：這筆資料是在有同步時被指派的，但目前這個分頁沒開同步
    // （或使用者剛好登出）——欄位不顯示，不代表指派本身要被丟掉。
    const task = makeTask('任務', false, { assigneeId: 'bob' })
    tasks.items = [task]

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await w.find('form').trigger('submit')

    const updated = tasks.items[0]
    expect(updated?.assigneeId).toBe('bob')
  })
})

describe('TaskDetailForm.vue — 任務層級線上狀態（isSyncConfigured 為 false）', () => {
  it('沒有設定同步時不顯示「同時檢視」，也不會因為嘗試建立 presence 訂閱而壞掉', () => {
    const pinia = freshPinia()
    const task = makeTask('任務', false, {})
    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    expect(w.text()).not.toContain('同時檢視')
  })
})
