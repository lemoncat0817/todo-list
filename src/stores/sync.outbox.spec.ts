import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { enqueueOp, getMeta, loadOutbox, setMeta } from '@/db'
import { META_SYNC_ACCOUNT_ID, META_SYNC_LAST_PULLED_AT } from '@/db/schema'

/**
 * stores/sync.ts 實際把 outbox 送出去（drainOutbox）的整合測試。
 * 拆成獨立檔案：vi.mock('@/sync/config', ...) 在檔案層級生效，
 * 跟 sync.spec.ts 其餘假設「沒有接 Supabase」的測試混在一起會互相
 * 干擾——那些測試本來就靠 isSyncConfigured=false 讓 tasks.ts 的
 * enqueueSyncOps() 完全不啟動，這裡刻意反過來。
 */
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

let activeSync: ReturnType<typeof useSyncStore> | null = null

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const app = { sync: useSyncStore(), auth: useAuthStore(), tasks: useTasksStore(), collections: useCollectionsStore() }
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

describe('drainOutbox：outbox 真的被送出並在成功後清空', () => {
  it('本地新增一筆任務，sync 跑一輪後對 create_task 發出 RPC 請求，op 從 outbox 移除', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    const task = tasks.add('要同步出去的任務')
    await tasks.flush()
    expect((await loadOutbox()).some((o) => o.targetId === task.id)).toBe(true)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const isGetPull = (options as RequestInit | undefined)?.method === 'GET'
      return { ok: true, json: async () => (isGetPull ? [] : {}) } as Response
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })

    const rpcCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/rpc/create_task'))
    expect(rpcCall, 'create_task 的 RPC 應該被呼叫').toBeDefined()
    const [, options] = rpcCall as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.p_row).toMatchObject({ task_name: '要同步出去的任務' })
    expect(sync.syncError).toBeNull()
  })

  it('RPC 失敗時，op 留在佇列裡（下一輪還會重試），syncError 顯示友善訊息', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    const task = tasks.add('會送失敗的任務')
    await tasks.flush()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/rpc/')) {
        return { ok: false, status: 500, text: async () => 'internal error' } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).not.toBeNull())

    const remaining = await loadOutbox()
    expect(remaining.some((o) => o.targetId === task.id)).toBe(true)
    expect(remaining.find((o) => o.targetId === task.id)?.attempts).toBe(1)
    expect(sync.syncError).toBe('伺服器暫時無法處理，稍後會自動重試')
  })

  it('換了不同的人登入時，上一個帳號還沒送出的 op 被清空，不會用新帳號的身分送出', async () => {
    const { sync, auth, tasks } = setup()
    await setMeta(META_SYNC_ACCOUNT_ID, 'userA')
    tasks.isLoading = false

    tasks.add('A 還沒送出的任務')
    await tasks.flush()
    expect(await loadOutbox()).not.toEqual([])

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)
    auth.session = fakeSession('token-b', 'userB')
    await sync.start()
    await nextTick()

    expect(await loadOutbox()).toEqual([])
  })

  it('連續失敗超過上限（attempts >= 5）的 op 會被捨棄，避免永久阻塞佇列', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    // 直接在 outbox 插入一個已經嘗試過 5 次的 op
    await enqueueOp({
      id: 'stuck-op',
      kind: 'task.delete',
      targetId: 'nonexistent-task',
      payload: { deleted_at: Date.now() },
      createdAt: Date.now(),
      attempts: 5,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)

    await sync.start()
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })
    expect(sync.syncError).toBeNull()
  })

  it('task.delete 遇到遠端不存在（PT002/TK002/404）時，視為刪除完成並自佇列移除', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    await enqueueOp({
      id: 'delete-op',
      kind: 'task.delete',
      targetId: 'already-gone-task',
      payload: { deleted_at: Date.now() },
      createdAt: Date.now(),
      attempts: 0,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/rpc/apply_task_patch')) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ code: 'TK002', message: '任務不存在或沒有寫入權限' }),
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })
    expect(sync.syncError).toBeNull()
  })

  it('task.create 撞 tasks_pkey（23505）時視為已建立，op 從佇列移除', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    await enqueueOp({
      id: 'dup-create',
      kind: 'task.create',
      targetId: 'already-on-server',
      payload: { id: 'already-on-server', task_name: '重複的' },
      createdAt: Date.now(),
      attempts: 0,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/rpc/create_task')) {
        return {
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              code: '23505',
              message: 'duplicate key value violates unique constraint "tasks_pkey"',
            }),
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })
    expect(sync.syncError).toBeNull()
  })

  it('遭遇不可重試的業務錯誤（PT001/TK001）時，移除 op 避免無效重試', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession()

    await enqueueOp({
      id: 'patch-op',
      kind: 'task.patch',
      targetId: 'deleted-task',
      payload: { notes: 'new note' },
      createdAt: Date.now(),
      attempts: 0,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/rpc/apply_task_patch')) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ code: 'TK001', message: '任務已經被其他成員刪除' }),
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).toBe('這筆任務已經被其他成員刪除，本機顯示的內容可能已經過期'))

    // 雖然報錯，但 op 已被移除，不會形成死鎖
    expect(await loadOutbox()).toEqual([])
  })

  it('本地已刪的標籤，即使拉取還拿到遠端活列，也不該被合併回來', async () => {
    const { sync, auth, collections } = setup()
    auth.session = fakeSession()
    await collections.load()

    const tag = collections.addTag('會被刪的')
    await collections.flush()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const u = String(url)
      const method = (options as RequestInit | undefined)?.method ?? 'GET'
      if (u.includes('/rpc/apply_tag_patch')) {
        return { ok: false, status: 500, text: async () => 'leave delete in outbox' } as Response
      }
      if (method === 'GET' && u.includes('/rest/v1/tasks')) {
        collections.removeTag(tag.id)
        await collections.flush()
      }
      if (method === 'GET' && u.includes('/rest/v1/tags')) {
        return {
          ok: true,
          json: async () => [
            {
              id: tag.id,
              name: tag.name,
              color: tag.color,
              updated_at: tag.updatedAt,
              deleted_at: null,
              workspace_id: tag.workspaceId,
            },
          ],
        } as Response
      }
      if (u.includes('/rpc/')) {
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })

    expect(
      collections.tags.map((t) => t.id),
      'outbox 還有 tag.delete 時，遠端活列不該把標籤加回來',
    ).not.toContain(tag.id)
  })
})
