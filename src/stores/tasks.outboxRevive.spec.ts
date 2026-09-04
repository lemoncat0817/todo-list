import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { loadOutbox } from '@/db'
import { makeTask, becomeWorkspaceMember } from '@/test/helpers'
import type { Session } from '@supabase/auth-js'

vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

let activeSync: ReturnType<typeof useSyncStore> | null = null

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const app = {
    tasks: useTasksStore(),
    collections: useCollectionsStore(),
    history: useHistoryStore(),
    workspace: useWorkspaceStore(),
    sync: useSyncStore(),
    auth: useAuthStore(),
  }
  activeSync = app.sync
  return app
}

function fakeSession(token = 'token-123', userId = 'u1'): Session {
  return {
    access_token: token,
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  } as unknown as Session
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  activeSync?.stop()
  activeSync = null
  vi.restoreAllMocks()
})

describe('任務與集合項目復活（清除 deleted_at）以防止 TK001', () => {
  it('匯入全新任務（本地指紋無此任務）時，排入 task.create 與帶有 deleted_at: null 的 task.patch', async () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    tasks.isLoading = false

    tasks.importBackup(
      {
        tasks: [makeTask('匯入的任務', false, { id: 'task-revive-1', workspaceId: 'ws-a', projectId: 'inbox-a' })],
        projects: [],
        tags: [],
        filters: [],
      },
      'merge',
    )
    await tasks.flush()

    const outbox = await loadOutbox()
    const createOp = outbox.find((o) => o.kind === 'task.create' && o.targetId === 'task-revive-1')
    const patchOp = outbox.find((o) => o.kind === 'task.patch' && o.targetId === 'task-revive-1')

    expect(createOp, '應產生 task.create').toBeDefined()
    expect(patchOp, '應產生 task.patch 以復活遠端可能已存在的墓碑列').toBeDefined()
    expect(patchOp?.payload).toMatchObject({ deleted_at: null, task_name: '匯入的任務' })
  })

  it('匯入本機已存在但欲復活的任務時，產生帶有 deleted_at: null 的 task.patch', async () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    tasks.isLoading = false

    // 先新增並 flush，建立本機指紋
    const task = tasks.add('既有任務')
    await tasks.flush()

    // 再次匯入此任務
    tasks.importBackup(
      {
        tasks: [{ ...task, taskName: '更新後的既有任務' }],
        projects: [],
        tags: [],
        filters: [],
      },
      'merge',
    )
    await tasks.flush()

    const outbox = await loadOutbox()
    const patchOps = outbox.filter((o) => o.kind === 'task.patch' && o.targetId === task.id)
    const latestPatch = patchOps[patchOps.length - 1]
    expect(latestPatch).toBeDefined()
    expect(latestPatch?.payload).toMatchObject({ deleted_at: null, task_name: '更新後的既有任務' })
  })

  it('刪除任務後復原（undo），產生的 task.patch 必須帶有 deleted_at: null', async () => {
    const { tasks, history, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    tasks.isLoading = false

    const task = tasks.add('即將被刪除的任務')
    await tasks.flush()

    tasks.remove(task.id)
    await tasks.flush()

    const outboxAfterDelete = await loadOutbox()
    expect(outboxAfterDelete.some((o) => o.kind === 'task.delete' && o.targetId === task.id)).toBe(true)

    // 復原刪除
    history.undo()
    await tasks.flush()

    const outboxAfterUndo = await loadOutbox()
    const reviveOp = outboxAfterUndo.find((o) => o.kind === 'task.patch' && o.targetId === task.id)
    expect(reviveOp, '復原刪除後應產生 task.patch').toBeDefined()
    expect(reviveOp?.payload).toMatchObject({ deleted_at: null })
  })

  it('清除已完成後復原（undo），產生的 task.patch 必須帶有 deleted_at: null', async () => {
    const { tasks, history, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    tasks.isLoading = false

    const task = tasks.add('已完成任務')
    tasks.toggle(task.id)
    await tasks.flush()

    tasks.clearCompleted()
    await tasks.flush()

    history.undo()
    await tasks.flush()

    const outbox = await loadOutbox()
    const reviveOp = outbox.find((o) => o.kind === 'task.patch' && o.targetId === task.id)
    expect(reviveOp, '復原 clearCompleted 後應產生 task.patch').toBeDefined()
    expect(reviveOp?.payload).toMatchObject({ deleted_at: null })
  })

  it('匯入專案與標籤時，排入帶有 deleted_at: null 的 patch 操作', async () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    tasks.isLoading = false

    tasks.importBackup(
      {
        tasks: [],
        projects: [
          { id: 'p-new', name: '新專案', color: '#123', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'ws-a' },
        ],
        tags: [
          { id: 't-new', name: '新標籤', color: '#456', updatedAt: 1, workspaceId: 'ws-a' },
        ],
        filters: [],
      },
      'merge',
    )
    await collections.flush()

    const outbox = await loadOutbox()
    const projectPatch = outbox.find((o) => o.kind === 'project.patch' && o.targetId === 'p-new')
    const tagPatch = outbox.find((o) => o.kind === 'tag.patch' && o.targetId === 't-new')

    expect(projectPatch).toBeDefined()
    expect(projectPatch?.payload).toMatchObject({ deleted_at: null, name: '新專案' })
    expect(tagPatch).toBeDefined()
    expect(tagPatch?.payload).toMatchObject({ deleted_at: null, name: '新標籤' })
  })

  it('送出到 Supabase 時，帶有 deleted_at: null 能正常傳入 apply_task_patch 而不會觸發 TK001', async () => {
    const { sync, auth, tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'u1')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    tasks.isLoading = false
    auth.session = fakeSession()

    // 匯入任務
    tasks.importBackup(
      {
        tasks: [makeTask('要復活的任務', false, { id: 'revive-sync-task', workspaceId: 'ws-a', projectId: 'inbox-a' })],
        projects: [],
        tags: [],
        filters: [],
      },
      'merge',
    )
    await tasks.flush()

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const isGetPull = (options as RequestInit | undefined)?.method === 'GET'
      return { ok: true, json: async () => (isGetPull ? [] : {}) } as Response
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })

    // 驗證 apply_task_patch 的 RPC payload 中確實有 deleted_at: null
    const patchCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/rpc/apply_task_patch'))
    expect(patchCall, 'apply_task_patch 的 RPC 應該被呼叫').toBeDefined()
    const [, options] = patchCall as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.p_patch).toHaveProperty('deleted_at', null)
    expect(sync.syncError).toBeNull()
  })
})
