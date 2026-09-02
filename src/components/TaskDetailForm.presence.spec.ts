import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'
import type { TaskPresenceEntry } from '@/sync/realtime'

// 理由同 DataDialog.push.spec.ts：isSyncConfigured 為 true 的情境需要
// 獨立成一支檔案。sync/realtime.ts 另外整份 mock 掉——這裡不測真的
// Realtime 連線（那是先前端到端跑過 Docker 網路驗證的範圍），只測
// TaskDetailForm.vue 有沒有正確呼叫它、正確顯示回呼帶回來的資料。
//
// useTaskPresence() 的 start() 是 async（動態 import sync/realtime.ts），
// 掛載元件本身是同步的，每個案例都要先 flushPromises() 讓那段
// await 真的跑完，才能斷言 subscribeToTaskPresence 被呼叫過。
const realtimeMocks = vi.hoisted(() => ({
  subscribeToTaskPresence: vi.fn(),
}))
vi.mock('@/sync/realtime', () => realtimeMocks)
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

function stubSubscription() {
  const updateFocus = vi.fn()
  const stop = vi.fn()
  let onChange: ((viewers: readonly TaskPresenceEntry[]) => void) | null = null
  realtimeMocks.subscribeToTaskPresence.mockImplementation((opts: { onChange: typeof onChange }) => {
    onChange = opts.onChange
    return { updateFocus, stop }
  })
  return { updateFocus, stop, emit: (viewers: TaskPresenceEntry[]) => onChange?.(viewers) }
}

afterEach(() => vi.restoreAllMocks())

describe('TaskDetailForm.vue — 任務層級的線上狀態與欄位編輯提示', () => {
  it('已登入且已設定同步時，開啟任務詳情會訂閱這筆任務的 presence', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    stubSubscription()
    const task = makeTask('任務', false, { id: 't1' })

    mountWith(TaskDetailForm, pinia, { props: { task } })
    await flushPromises()

    expect(realtimeMocks.subscribeToTaskPresence).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', userId: 'me' }),
    )
  })

  it('沒有其他檢視者時不顯示「同時檢視」列', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    stubSubscription()
    const task = makeTask('任務', false, { id: 't1' })

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await flushPromises()

    expect(w.text()).not.toContain('同時檢視')
  })

  it('presence 回報有其他檢視者時，顯示對方的名字', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    useWorkspaceStore().members = [
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]
    const { emit } = stubSubscription()
    const task = makeTask('任務', false, { id: 't1' })

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await flushPromises()
    emit([{ userId: 'bob', focusedField: null }])
    await w.vm.$nextTick()

    expect(w.text()).toContain('同時檢視')
    expect(w.text()).toContain('Bob')
  })

  it('聚焦名稱欄位會回報 taskName，離開欄位回報 null', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    const { updateFocus } = stubSubscription()
    const task = makeTask('任務', false, { id: 't1' })

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await flushPromises()
    const nameInput = w.find('input[required]')
    await nameInput.trigger('focus')
    expect(updateFocus).toHaveBeenCalledWith('taskName')

    await nameInput.trigger('blur')
    expect(updateFocus).toHaveBeenCalledWith(null)
  })

  it('別人正聚焦在某個欄位時，那個欄位會加上柔和邊框的樣式', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    const { emit } = stubSubscription()
    const task = makeTask('任務', false, { id: 't1' })

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await flushPromises()
    const nameInput = w.find('input[required]')
    expect(nameInput.classes()).not.toContain('ring-2')

    emit([{ userId: 'bob', focusedField: 'taskName' }])
    await w.vm.$nextTick()

    expect(nameInput.classes()).toContain('ring-2')
  })

  it('切換到別的任務時，先停掉舊的訂閱再開新的', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useAuthStore().session = { user: { id: 'me' }, access_token: 'token' } as never
    const { stop } = stubSubscription()
    const taskA = makeTask('任務 A', false, { id: 'a' })
    const taskB = makeTask('任務 B', false, { id: 'b' })

    const w = mountWith(TaskDetailForm, pinia, { props: { task: taskA } })
    await flushPromises()
    await w.setProps({ task: taskB })
    await flushPromises()

    expect(stop).toHaveBeenCalled()
    expect(realtimeMocks.subscribeToTaskPresence).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'b' }))
  })
})
