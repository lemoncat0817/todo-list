import { describe, it, expect, afterEach, vi } from 'vitest'
import NotificationCenterDialog from '@/components/NotificationCenterDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { useNotificationsStore } from '@/stores/notifications'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

function setup() {
  const pinia = freshPinia()
  useAuthStore().session = {
    access_token: 'token-123', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: 'me' },
  } as never
  useWorkspaceStore().members = [
    { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
  ]
  // markRead()／markAllRead() 樂觀更新本地狀態後才打網路，這裡不關心
  // 網路呼叫本身（那是 sync/notificationsClient.spec.ts 的範圍），只是
  // 避免 happy-dom 真的嘗試 fetch 而在主控台印一堆噪音。
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)
  return pinia
}

afterEach(() => vi.restoreAllMocks())

describe('NotificationCenterDialog.vue', () => {
  it('沒有通知時顯示空狀態', () => {
    const pinia = setup()
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('還沒有通知')
  })

  it('顯示觸發者名稱、事件類型、任務名稱', () => {
    const pinia = setup()
    useTasksStore().items = [makeTask('寫週報', false, { id: 't1' })]
    useNotificationsStore().mergeRemote([
      { id: 'n1', actorId: 'bob', kind: 'assignment', taskId: 't1', body: '寫週報', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })

    expect(w.text()).toContain('Bob')
    expect(w.text()).toContain('把任務指派給你')
    expect(w.text()).toContain('寫週報')
  })

  it('任務已被刪除時顯示對應說法，不是空白', () => {
    const pinia = setup()
    useNotificationsStore().mergeRemote([
      { id: 'n1', actorId: 'bob', kind: 'mention', taskId: 'gone', body: 'x', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('（已刪除的任務）')
  })

  it('點擊一則通知會呼叫 markRead', async () => {
    const pinia = setup()
    useTasksStore().items = [makeTask('寫週報', false, { id: 't1' })]
    const notifications = useNotificationsStore()
    notifications.mergeRemote([
      { id: 'n1', actorId: 'bob', kind: 'mention', taskId: 't1', body: 'x', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })
    await w.find('li button').trigger('click')

    expect(notifications.items[0]?.readAt).not.toBeNull()
  })

  it('沒有未讀時不顯示「全部標為已讀」', () => {
    const pinia = setup()
    useTasksStore().items = [makeTask('寫週報', false, { id: 't1' })]
    useNotificationsStore().mergeRemote([
      { id: 'n1', actorId: 'bob', kind: 'mention', taskId: 't1', body: 'x', readAt: 5, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })
    expect(w.text()).not.toContain('全部標為已讀')
  })

  it('有未讀時「全部標為已讀」會呼叫 markAllRead', async () => {
    const pinia = setup()
    useTasksStore().items = [makeTask('寫週報', false, { id: 't1' })]
    const notifications = useNotificationsStore()
    notifications.mergeRemote([
      { id: 'n1', actorId: 'bob', kind: 'mention', taskId: 't1', body: 'x', readAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'n2', actorId: 'bob', kind: 'assignment', taskId: 't1', body: 'x', readAt: null, createdAt: 2, updatedAt: 2 },
    ])
    const w = mountWith(NotificationCenterDialog, pinia, { props: { open: true } })
    const markAllButton = w.findAll('button').find((b) => b.text() === '全部標為已讀')
    await markAllButton?.trigger('click')

    expect(notifications.unreadCount).toBe(0)
  })
})
