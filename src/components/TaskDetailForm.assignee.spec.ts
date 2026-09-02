import { describe, it, expect, vi } from 'vitest'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import { useTasksStore } from '@/stores/tasks'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

// vi.mock 就算寫在 describe 區塊裡面，Vitest 還是整個檔案生效（跑的時候
// 會直接警告這件事）——跟 DataDialog.spec.ts／DataDialog.push.spec.ts
// 同一個坑，所以「isSyncConfigured 為 true」的情境獨立成這支檔案。
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

describe('TaskDetailForm.vue — 指派給（isSyncConfigured 為 true）', () => {
  function setup(assigneeId: string | null = null) {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' } } as never
    useWorkspaceStore().members = [
      { user_id: 'me', role: 'owner', joined_at: '2030-01-01', profiles: { display_name: '我自己', avatar_url: null } },
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]
    const tasks = useTasksStore()
    const task = makeTask('任務', false, { assigneeId })
    tasks.items = [task]
    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    return { w, tasks, task }
  }

  it('已登入且已設定同步時顯示指派欄位，選項來自 workspace.members', () => {
    const { w } = setup()
    expect(w.text()).toContain('指派給')
    const options = w.findAll('select option').map((o) => o.text())
    expect(options).toContain('未指派')
    expect(options).toContain('我自己')
    expect(options).toContain('Bob')
  })

  it('未登入時指派欄位不顯示', () => {
    const pinia = freshPinia()
    // status 保持預設的 signed-out
    const task = makeTask('任務', false, { assigneeId: null })
    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    expect(w.text()).not.toContain('指派給')
  })

  it('選一個成員並儲存，assigneeId 真的被指派過去', async () => {
    const { w, tasks } = setup(null)
    const selects = w.findAll('select')
    // 第一個 select 是優先度，第二個是指派給（模板順序：優先度 → 到期日/時間 → 專案 → 指派給）。
    const assigneeSelect = selects.find((s) => s.findAll('option').some((o) => o.text() === '未指派'))
    expect(assigneeSelect).toBeDefined()
    await assigneeSelect?.setValue('bob')
    await w.find('form').trigger('submit')

    expect(tasks.items[0]?.assigneeId).toBe('bob')
  })

  it('選回「未指派」並儲存，assigneeId 變成 null', async () => {
    const { w, tasks } = setup('bob')
    const selects = w.findAll('select')
    const assigneeSelect = selects.find((s) => s.findAll('option').some((o) => o.text() === '未指派'))
    await assigneeSelect?.setValue('')
    await w.find('form').trigger('submit')

    expect(tasks.items[0]?.assigneeId).toBeNull()
  })
})
