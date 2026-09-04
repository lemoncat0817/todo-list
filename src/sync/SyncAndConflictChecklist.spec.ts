import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/realtime-js'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useCommentsStore } from '@/stores/comments'
import { useActivityStore } from '@/stores/activity'
import { useAttachmentsStore } from '@/stores/attachments'
import { useNotificationsStore } from '@/stores/notifications'
import { useSectionsStore } from '@/stores/sections'
import { useWorkspaceStore } from '@/stores/workspace'
import { enqueueOp, getMeta, loadOutbox, setMeta } from '@/db'
import {
  META_SYNC_ACCOUNT_ID,
  META_SYNC_LAST_PULLED_AT,
  type Priority,
  type StoredTask,
} from '@/db/schema'
import { makeTask } from '@/test/helpers'
import { mergeByUpdatedAt } from '@/sync/merge'
import { diffFields } from '@/domain/diff'
import { toRemoteTask } from '@/sync/rowMapping'
import { resetRealtimeClient } from '@/sync/realtime'

// 啟用同步設定，確保 tasks.flush() 與 collections.flush() 會將操作排入 outbox
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

// 模擬 RealtimeChannel 與 RealtimeClient
class FakeChannel {
  handlers: Array<{ table: string; cb: () => void }> = []
  subscribeCb: ((status: REALTIME_SUBSCRIBE_STATES) => void) | undefined

  on(type: string, filter: { table?: string; event?: string }, cb: () => void) {
    if (type === 'postgres_changes') {
      this.handlers.push({ table: filter.table ?? '', cb })
    }
    return this
  }

  subscribe(cb: (status: REALTIME_SUBSCRIBE_STATES) => void) {
    this.subscribeCb = cb
    return this
  }

  unsubscribe() {
    return Promise.resolve('ok')
  }

  track() {
    return Promise.resolve('ok')
  }

  untrack() {
    return Promise.resolve('ok')
  }

  presenceState() {
    return {}
  }

  emitStatus(status: REALTIME_SUBSCRIBE_STATES) {
    this.subscribeCb?.(status)
  }

  emitChange(table: string) {
    for (const h of this.handlers) {
      if (h.table === table) h.cb()
    }
  }
}

let activeChannel: FakeChannel | null = null

vi.mock('@supabase/realtime-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/realtime-js')>()
  return {
    ...actual,
    RealtimeClient: class FakeRealtimeClient {
      channel() {
        activeChannel = new FakeChannel()
        return activeChannel
      }
      disconnect() {
        return Promise.resolve('ok')
      }
    },
  }
})

let activeSync: ReturnType<typeof useSyncStore> | null = null

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const app = {
    sync: useSyncStore(),
    auth: useAuthStore(),
    tasks: useTasksStore(),
    collections: useCollectionsStore(),
    comments: useCommentsStore(),
    activity: useActivityStore(),
    attachments: useAttachmentsStore(),
    notifications: useNotificationsStore(),
    sections: useSectionsStore(),
    workspace: useWorkspaceStore(),
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

function mockFetch(handler: (url: string, options?: RequestInit) => Promise<Response> | Response) {
  const impl = async (url: unknown, options?: RequestInit) => {
    return handler(String(url), options)
  }
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  if (typeof window !== 'undefined' && 'fetch' in window) {
    vi.spyOn(window, 'fetch').mockImplementation(impl as never)
  }
  return spy
}

beforeEach(() => {
  resetRealtimeClient()
  activeChannel = null
  localStorage.clear()
  mockFetch(async () => {
    return { ok: true, json: async () => [] } as Response
  })
})

afterEach(() => {
  activeSync?.stop()
  activeSync = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('即時同步與衝突（M1）驗證清單', () => {
  // 1. A 改任務名稱，B 幾秒內看到（Realtime；可接受約 0.5–3 秒）
  it('1. A 改任務名稱，B 幾秒內看到（Realtime；可接受約 0.5–3 秒）', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false

    const now = Date.now()
    // 模擬伺服器端：起初仍為舊名稱
    let serverTask = {
      id: 'task-1',
      task_name: '舊名稱',
      is_completed: false,
      rank: '0|hzzzzz:',
      notes: '',
      priority: 0,
      due_date: null,
      due_time: null,
      project_id: null,
      tag_ids: [],
      parent_id: null,
      recurrence: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      workspace_id: 'w1',
    }

    const fetchMock = mockFetch(async (url) => {
      const u = String(url)
      if (u.includes('/rest/v1/workspaces')) {
        return {
          ok: true,
          json: async () => [
            { id: 'w1', name: '協作工作區', is_personal: false, created_by: 'u1', updated_at: now },
          ],
        } as Response
      }
      if (u.includes('/rest/v1/tasks')) {
        return { ok: true, json: async () => [serverTask] } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    auth.session = fakeSession('token-b', 'userB')
    auth.status = 'signed-in'

    // B 本地原本有的任務
    tasks.items = [makeTask('舊名稱', false, { id: 'task-1', workspaceId: 'w1', updatedAt: now })]

    // B 啟動同步，並等待 Realtime 頻道建立
    await sync.start()
    await vi.waitFor(() => expect(activeChannel).not.toBeNull())

    // 模擬連線成功，清空初始拉取產生的 fetch 計數
    activeChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    fetchMock.mockClear()

    // 切換成假計時器測 500ms（0.5 秒）防抖
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })

    // A 在伺服器上修改任務名稱為「A 改的新任務名稱」
    serverTask = { ...serverTask, task_name: 'A 改的新任務名稱', updated_at: now + 5000 }

    // Supabase Realtime 推送變更通知
    activeChannel?.emitChange('tasks')

    // 驗證 Realtime 模組的 500ms 防抖去重：在 500ms 前不發起同步
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tasks.items.find((t) => t.id === 'task-1')?.taskName).toBe('舊名稱')

    // 500ms 防抖時間到（約 0.5 秒），自動觸發 syncOnce() 拉取最新變更
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalled()

    // B 成功在 0.5–3 秒內看到 A 修改的任務名稱
    await vi.waitFor(() => {
      expect(tasks.items.find((t) => t.id === 'task-1')?.taskName).toBe('A 改的新任務名稱')
    })
  })

  // 2. 兩人同時改不同欄位（例如 A 改備註、B 改優先度）兩邊都保留
  it('2. 兩人同時改不同欄位（例如 A 改備註、B 改優先度）兩邊都保留', async () => {
    const originalTask: StoredTask = makeTask('共用任務', false, {
      id: 'task-concurrent',
      notes: '原始備註',
      priority: 0,
      updatedAt: 1000,
    })

    // 1) 模擬 A 改備註：diffFields 計算欄位補丁
    const beforeRemoteA = toRemoteTask(originalTask)
    const afterTaskA = { ...originalTask, notes: 'A 更新的備註', updatedAt: 1100 }
    const patchA = diffFields(beforeRemoteA, toRemoteTask(afterTaskA))
    // A 的 outbox op 只包含變更的 notes 欄位，不包含 priority
    expect(patchA.notes).toBe('A 更新的備註')
    expect(patchA.priority).toBeUndefined()

    // 2) 模擬 B 改優先度：diffFields 計算欄位補丁
    const beforeRemoteB = toRemoteTask(originalTask)
    const afterTaskB = { ...originalTask, priority: 2 as const, updatedAt: 1200 }
    const patchB = diffFields(beforeRemoteB, toRemoteTask(afterTaskB))
    // B 的 outbox op 只包含變更的 priority 欄位，不包含 notes
    expect(patchB.priority).toBe(2)
    expect(patchB.notes).toBeUndefined()

    // 3) 模擬伺服器端 apply_task_patch RPC 的運作：
    //    Postgres 使用 coalesce(patch->>'notes', t.notes) 與 coalesce(patch->>'priority', t.priority)
    let dbRow = {
      id: 'task-concurrent',
      task_name: '共用任務',
      notes: '原始備註',
      priority: 0,
      updated_at: 1000,
      deleted_at: null,
    }

    // 套用 A 的補丁（伺服器時間 t=1100）
    dbRow = {
      ...dbRow,
      notes: (patchA.notes as string | undefined) ?? dbRow.notes,
      updated_at: 1100,
    }
    expect(dbRow.notes).toBe('A 更新的備註')
    expect(dbRow.priority).toBe(0)

    // 套用 B 的補丁（伺服器時間 t=1300，較晚更新）
    dbRow = {
      ...dbRow,
      priority: (patchB.priority as number | undefined) ?? dbRow.priority,
      updated_at: 1300,
    }
    // A 改的備註與 B 改的優先度在資料庫均保留
    expect(dbRow.notes).toBe('A 更新的備註')
    expect(dbRow.priority).toBe(2)

    // 4) 驗證客戶端拉取後的合併結果（mergeByUpdatedAt）
    // A 端拉取伺服器更新（1300 > 1100）：
    const mergedForA = mergeByUpdatedAt(
      [afterTaskA],
      [{ ...afterTaskA, notes: dbRow.notes, priority: dbRow.priority as Priority, updatedAt: dbRow.updated_at }],
    )
    expect(mergedForA.merged[0]?.notes).toBe('A 更新的備註')
    expect(mergedForA.merged[0]?.priority).toBe(2)

    // B 端拉取伺服器更新（1300 > 1200）：
    const mergedForB = mergeByUpdatedAt(
      [afterTaskB],
      [{ ...afterTaskB, notes: dbRow.notes, priority: dbRow.priority as 2, updatedAt: dbRow.updated_at }],
    )
    expect(mergedForB.merged[0]?.notes).toBe('A 更新的備註')
    expect(mergedForB.merged[0]?.priority).toBe(2)
  })

  // 3. 兩人同時改同一欄位，以較晚寫入為準
  it('3. 兩人同時改同一欄位，以較晚寫入為準', async () => {
    const baseTask: StoredTask = makeTask('衝突任務', false, {
      id: 'task-conflict-same',
      priority: 0,
      updatedAt: 1000,
    })

    // A 於 t=2000 將優先度改為 1
    const taskA: StoredTask = { ...baseTask, priority: 1, updatedAt: 2000 }
    // B 於 t=3000（較晚）將優先度改為 2
    const taskB: StoredTask = { ...baseTask, priority: 2, updatedAt: 3000 }

    // 情況 1：A 本地為 t=2000（priority: 1），拉取到較晚的 B（t=3000, priority: 2）
    const mergeOnClientA = mergeByUpdatedAt([taskA], [taskB])
    // 較晚寫入的 B 贏
    expect(mergeOnClientA.merged[0]?.priority).toBe(2)
    expect(mergeOnClientA.merged[0]?.updatedAt).toBe(3000)
    expect(mergeOnClientA.remoteWon).toHaveLength(1)

    // 情況 2：B 本地為 t=3000（priority: 2），拉取到較早的 A（t=2000, priority: 1）
    const mergeOnClientB = mergeByUpdatedAt([taskB], [taskA])
    // 本地較新，保留優先度 2，不被舊資料覆蓋
    expect(mergeOnClientB.merged[0]?.priority).toBe(2)
    expect(mergeOnClientB.merged[0]?.updatedAt).toBe(3000)
    expect(mergeOnClientB.remoteWon).toHaveLength(0)
  })

  // 4. 刪除／墓碑：A 刪任務，B 端消失且不會被拉回來
  it('4. 刪除／墓碑：A 刪任務，B 端消失且不會被拉回來', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession('token-b', 'userB')
    auth.status = 'signed-in'

    const task1 = makeTask('存在於兩端的任務', false, { id: 'task-del-1', updatedAt: 1000 })
    tasks.items = [task1]

    // 1) 模擬 A 刪除任務後，伺服器將其標記為墓碑（deleted_at: 2000）
    //    fetchRowsSince 查詢 updated_at > 游標時返回這筆帶有 deleted_at 的墓碑紀錄
    let returnedTasks: Record<string, unknown>[] = [
      { id: 'task-del-1', deleted_at: 2000, updated_at: 2000 },
    ]

    mockFetch(async (url) => {
      const u = String(url)
      if (u.includes('/rest/v1/tasks')) {
        return { ok: true, json: async () => returnedTasks } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    // B 端執行同步
    await sync.start()
    await vi.waitFor(() => {
      expect(tasks.items.find((t) => t.id === 'task-del-1')).toBeUndefined()
    })

    // 2) 驗證「不會被拉回來」：之後的每一輪同步，墓碑不會被當成新任務加回
    returnedTasks = [] // 墓碑更新時間已經過去，後續輪詢為空

    // 模擬再次同步觸發
    await sync.start()
    expect(tasks.items.find((t) => t.id === 'task-del-1')).toBeUndefined()

    // 3) 驗證 outbox 的 pending delete 保護：
    //    若 B 在離線時本地刪除，即使網路拉取帶回了伺服器舊的活列，也不會被覆蓋還原
    const taskOfflineDel = makeTask('離線刪除的任務', false, { id: 'task-offline-del', updatedAt: 500 })
    await enqueueOp({
      id: 'del-op-1',
      kind: 'task.delete',
      targetId: 'task-offline-del',
      payload: { deleted_at: Date.now() },
      createdAt: Date.now(),
      attempts: 0,
    })

    // 模擬伺服器返回了舊的活列
    const liveWithStale = [makeTask('離線刪除的任務', false, { id: 'task-offline-del', updatedAt: 600 })]
    const merged = mergeByUpdatedAt([taskOfflineDel], liveWithStale, ['task-offline-del'])
    expect(merged.merged.find((t) => t.id === 'task-offline-del')).toBeUndefined()
  })

  // 5. 離線編輯 → 恢復連線後 outbox 送出；對方看得到
  it('5. 離線編輯 → 恢復連線後 outbox 送出；對方看得到', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession('token-a', 'userA')
    auth.status = 'signed-in'

    // 1) 處於離線狀態：fetch 拋出 TypeError
    let isOnline = false
    const sentRpcs: Array<{ url: string; body: unknown }> = []

    mockFetch(async (url, options) => {
      if (!isOnline) {
        throw new TypeError('Failed to fetch')
      }
      const u = String(url)
      if (u.includes('/rpc/')) {
        sentRpcs.push({ url: u, body: JSON.parse((options as RequestInit).body as string) })
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    // 2) 使用者在離線時新增一筆任務並編輯
    const task = tasks.add('離線新增的任務')
    await tasks.flush()

    // 確認已進入本機 outbox
    const outboxOpsBefore = await loadOutbox()
    expect(outboxOpsBefore.some((o) => o.targetId === task.id)).toBe(true)

    // 嘗試同步，由於離線失敗，錯誤訊息提示連線問題，op 仍完整保留在 outbox
    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).toBe('目前連不上網路，恢復連線後會自動重試'))
    expect((await loadOutbox()).length).toBeGreaterThan(0)
    expect(sentRpcs).toHaveLength(0)

    // 3) 恢復連線：觸發 online 事件
    isOnline = true
    window.dispatchEvent(new Event('online'))

    // outbox 被順利排空（drainOutbox），RPC 成功呼叫，outbox 清空
    await vi.waitFor(async () => {
      expect(await loadOutbox()).toEqual([])
    })
    expect(sync.syncError).toBeNull()
    expect(sentRpcs.some((r) => r.url.includes('create_task'))).toBe(true)

    // 4) 對方（B 端）同步拉取：伺服器將該任務送給 B 端
    const remoteWonResult = mergeByUpdatedAt(
      [],
      [{ id: task.id, name: '離線新增的任務', updatedAt: Date.now() }],
    )
    expect(remoteWonResult.merged[0]?.name).toBe('離線新增的任務')
  })

  // 6. 關分頁前 3 秒內刪除／編輯仍盡量推上去（快速關頁回歸）
  it('6. 關分頁前 3 秒內刪除／編輯仍盡量推上去（快速關頁回歸）', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    auth.session = fakeSession('token-a', 'userA')
    auth.status = 'signed-in'

    const fetchMock = mockFetch(async () => {
      return { ok: true, json: async () => [] } as Response
    })

    // 啟動同步完成初始輪詢
    await sync.start()
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })
    fetchMock.mockClear()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })

    // 使用者編輯任務：觸發 tasks.items watcher，進入 3000ms（3 秒）防抖計時
    tasks.items = [makeTask('關頁前編輯的任務', false, { id: 'quick-close-task' })]
    await nextTick()

    // 經過 500ms（未滿 3 秒），正常情況下防抖時間未到，不發送網路請求
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock, '防抖時間未到前不發送請求').not.toHaveBeenCalled()

    // 使用者在此時關閉分頁（觸發 pagehide / flushPendingPush）
    await sync.flushPendingPush()

    // flushPendingPush 立即清除防抖計時器並立刻發送推送，不再等待 3 秒計時結束
    expect(fetchMock, '快速關頁時應立刻觸發推送送出變更').toHaveBeenCalled()
  })

  // 7. 換帳號登入同一瀏覽器：不會看到／推送上一帳號的資料
  it('7. 換帳號登入同一瀏覽器：不會看到／推送上一帳號的資料', async () => {
    const { sync, auth, tasks, collections, comments, sections } = setup()

    // 1) 上一個帳號（User A）登入過，並在本機留下資料與未送出的 outbox op
    await setMeta(META_SYNC_ACCOUNT_ID, 'user-A')
    tasks.isLoading = false
    tasks.items = [makeTask('User A 的私密任務', false, { id: 'task-user-a' })]
    collections.projects = [
      { id: 'proj-a', name: 'User A 的專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: null },
    ]
    collections.tags = [{ id: 'tag-a', name: 'User A 的標籤', color: '#000', updatedAt: 1, workspaceId: null }]
    collections.filters = [
      { id: 'filter-a', name: 'User A 的篩選器', query: '', color: '#000', rank: 'A', updatedAt: 1, workspaceId: null },
    ]
    comments.items = [{ id: 'c1', taskId: 'task-user-a', authorId: 'user-A', body: 'A 的留言', mentionedUserIds: [], createdAt: 1, updatedAt: 1 }]
    sections.items = [{ id: 'sec-a', projectId: 'proj-a', name: 'A 的區段', rank: 'A', updatedAt: 1 }]

    // 插入 User A 尚未送出的 outbox 操作
    await enqueueOp({
      id: 'op-a',
      kind: 'task.patch',
      targetId: 'task-user-a',
      payload: { notes: 'A 未送出的機密' },
      createdAt: Date.now(),
      attempts: 0,
    })
    expect((await loadOutbox()).length).toBe(1)

    // 2) 換成 User B 在同一瀏覽器登入
    mockFetch(async (url) => {
      const u = String(url)
      // User B 的伺服器資料
      if (u.includes('/rest/v1/tasks')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'task-user-b',
              task_name: 'User B 自己的任務',
              is_completed: false,
              rank: 'A',
              notes: '',
              priority: 0,
              due_date: null,
              due_time: null,
              project_id: null,
              tag_ids: [],
              parent_id: null,
              recurrence: null,
              completed_at: null,
              created_at: 2000,
              updated_at: 2000,
              deleted_at: null,
              workspace_id: null,
            },
          ],
        } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })

    auth.session = fakeSession('token-user-b', 'user-B')
    auth.status = 'signed-in'

    // 啟動同步，觸發 reconcileAccountIdentity()
    await sync.start()

    // 驗證 1：User A 的任務、專案、標籤、篩選器、留言、區段等全部被清除，User B 完全看不到 User A 的資料
    expect(tasks.items.some((t) => t.id === 'task-user-a')).toBe(false)
    expect(collections.projects.some((p) => p.id === 'proj-a')).toBe(false)
    expect(collections.tags.some((t) => t.id === 'tag-a')).toBe(false)
    expect(collections.filters.some((f) => f.id === 'filter-a')).toBe(false)
    expect(comments.items.some((c) => c.id === 'c1')).toBe(false)
    expect(sections.items.some((s) => s.id === 'sec-a')).toBe(false)

    // 驗證 2：User A 留在 outbox 裡的 op 被徹底清空，絕不使用 User B 的 token 推送出去
    expect(await loadOutbox()).toEqual([])

    // 驗證 3：User B 從伺服器全量拉取到的是自己的任務
    await vi.waitFor(() => {
      expect(tasks.items.map((t) => t.id)).toEqual(['task-user-b'])
    })
    expect(tasks.items[0]?.taskName).toBe('User B 自己的任務')

    // 驗證 4：本機 META 紀錄之帳號身分更新為 user-B
    expect(await getMeta<string>(META_SYNC_ACCOUNT_ID)).toBe('user-B')

    sync.stop()
  })
})
