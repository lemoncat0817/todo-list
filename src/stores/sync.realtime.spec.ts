import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * stores/sync.ts 對 sync/realtime.ts 的訂閱管理（誰訂閱了哪個工作區、
 * 什麼時候取消）。realtime.ts 本身的行為（去抖動、狀態對應）已經在
 * realtime.spec.ts 測過，這裡驗證的是「stores/sync.ts 怎麼用它」。
 */
interface FakeSubscribeCall {
  workspaceId: string
  onChange: () => void
  onSubscribed: () => void
}

let subscribeCalls: FakeSubscribeCall[] = []
let stoppedWorkspaceIds: string[] = []

vi.mock('@/sync/realtime', () => ({
  subscribeToWorkspace: vi.fn((opts: FakeSubscribeCall) => {
    subscribeCalls.push(opts)
    return { stop: () => stoppedWorkspaceIds.push(opts.workspaceId) }
  }),
}))

let activeSync: ReturnType<typeof useSyncStore> | null = null

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const app = { sync: useSyncStore(), auth: useAuthStore(), tasks: useTasksStore(), workspace: useWorkspaceStore() }
  activeSync = app.sync
  return app
}

function fakeSession(): Session {
  return {
    access_token: 'token-123',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1' },
  } as unknown as Session
}

function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)
}

beforeEach(() => {
  subscribeCalls = []
  stoppedWorkspaceIds = []
  localStorage.clear()
})

afterEach(() => {
  activeSync?.stop()
  activeSync = null
  vi.restoreAllMocks()
})

describe('Realtime 訂閱', () => {
  it('登入後對 workspace.workspaces 裡的每個工作區各訂閱一次', async () => {
    const { sync, auth, tasks, workspace } = setup()
    tasks.isLoading = false
    mockFetch()
    auth.session = fakeSession()

    workspace.workspaces = [
      { id: 'w1', name: '個人工作區', is_personal: true, created_by: 'u1', updated_at: 1 },
      { id: 'w2', name: '團隊', is_personal: false, created_by: 'u2', updated_at: 1 },
    ]

    await sync.start()
    await vi.waitFor(() => expect(subscribeCalls.map((c) => c.workspaceId).sort()).toEqual(['w1', 'w2']))
  })

  it('工作區清單變短時，取消不再存在的那個訂閱', async () => {
    const { sync, auth, tasks, workspace } = setup()
    tasks.isLoading = false
    mockFetch()
    auth.session = fakeSession()
    workspace.workspaces = [{ id: 'w1', name: 'A', is_personal: true, created_by: 'u1', updated_at: 1 }]

    await sync.start()
    await vi.waitFor(() => expect(subscribeCalls).toHaveLength(1))

    workspace.workspaces = []
    await vi.waitFor(() => expect(stoppedWorkspaceIds).toContain('w1'))
  })

  it('onChange／onSubscribed 觸發時會呼叫一次同步（間接反映在 lastPulledAt 更新）', async () => {
    const { sync, auth, tasks, workspace } = setup()
    tasks.isLoading = false
    mockFetch()
    auth.session = fakeSession()
    workspace.workspaces = [{ id: 'w1', name: 'A', is_personal: true, created_by: 'u1', updated_at: 1 }]

    await sync.start()
    await vi.waitFor(() => expect(subscribeCalls).toHaveLength(1))
    await vi.waitFor(() => expect(sync.lastPulledAt).not.toBeNull())

    const before = sync.lastPulledAt
    subscribeCalls[0]?.onChange()
    await vi.waitFor(() => expect(sync.lastPulledAt).toBeGreaterThan(before as number))
  })

  it('stop() 時取消所有訂閱', async () => {
    const { sync, auth, tasks, workspace } = setup()
    tasks.isLoading = false
    mockFetch()
    auth.session = fakeSession()
    workspace.workspaces = [
      { id: 'w1', name: 'A', is_personal: true, created_by: 'u1', updated_at: 1 },
      { id: 'w2', name: 'B', is_personal: false, created_by: 'u2', updated_at: 1 },
    ]

    await sync.start()
    await vi.waitFor(() => expect(subscribeCalls).toHaveLength(2))

    sync.stop()

    expect(stoppedWorkspaceIds.sort()).toEqual(['w1', 'w2'])
  })
})
