import { describe, it, expect, vi } from 'vitest'
import TaskMeta from '@/components/TaskMeta.vue'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

// 理由同 TaskDetailForm.assignee.spec.ts：isSyncConfigured 為 true 的
// 情境需要獨立成一支檔案，vi.mock 實際上整個檔案生效。
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

/** 只驗證這次新增的指派標記——優先度/到期日/專案/標籤等既有標記沒有專屬測試檔。 */
describe('TaskMeta.vue — 指派標記', () => {
  it('未指派時不顯示指派標記', () => {
    const pinia = freshPinia()
    const task = makeTask('任務', false, { assigneeId: null })
    const w = mountWith(TaskMeta, pinia, { props: { task } })
    expect(w.text()).not.toContain('→')
  })

  it('已指派時顯示成員名稱（自己是「我」）', () => {
    const pinia = freshPinia()
    useAuthStore().session = { user: { id: 'me' } } as never
    useWorkspaceStore().members = [
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]
    const task = makeTask('任務', false, { assigneeId: 'bob' })
    const w = mountWith(TaskMeta, pinia, { props: { task } })
    expect(w.text()).toContain('Bob')
  })

  it('指派給自己時顯示「我」', () => {
    const pinia = freshPinia()
    useAuthStore().session = { user: { id: 'me' } } as never
    const task = makeTask('任務', false, { assigneeId: 'me' })
    const w = mountWith(TaskMeta, pinia, { props: { task } })
    expect(w.text()).toContain('我')
  })
})
