import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const clientMocks = vi.hoisted(() => ({
  fetchNotificationPrefs: vi.fn(),
  upsertNotificationPrefs: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  DEFAULT_NOTIFICATION_PREFS: { notifyOnMention: true, notifyOnAssignment: true, dailyDigestEnabled: false },
}))
vi.mock('@/sync/notificationsClient', () => clientMocks)

const { useNotificationsStore } = await import('@/stores/notifications')
const { useAuthStore } = await import('@/stores/auth')
const { loadNotifications } = await import('@/db')

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { notifications: useNotificationsStore(), auth: useAuthStore() }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('notifications store — 基本讀寫（跟 activity store 同一套形狀）', () => {
  it('mergeRemote 聯集新資料，依 id 去重', () => {
    const { notifications } = setup()
    notifications.mergeRemote([
      { id: 'n1', actorId: 'u1', kind: 'mention', taskId: 't1', body: 'x', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    notifications.mergeRemote([
      { id: 'n1', actorId: 'u1', kind: 'mention', taskId: 't1', body: 'x', readAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'n2', actorId: 'u1', kind: 'assignment', taskId: 't1', body: 'y', readAt: null, createdAt: 2, updatedAt: 2 },
    ])
    expect(notifications.items).toHaveLength(2)
  })

  it('sorted 依 createdAt 由新到舊排序', () => {
    const { notifications } = setup()
    notifications.mergeRemote([
      { id: 'old', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'new', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 2, updatedAt: 2 },
    ])
    expect(notifications.sorted.map((n) => n.id)).toEqual(['new', 'old'])
  })

  it('unreadCount 只算 readAt 為 null 的', () => {
    const { notifications } = setup()
    notifications.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'n2', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: 5, createdAt: 2, updatedAt: 2 },
    ])
    expect(notifications.unreadCount).toBe(1)
  })

  it('persist() 寫進 IndexedDB，load() 讀得回來', async () => {
    const first = setup().notifications
    first.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    await first.persist()
    expect((await loadNotifications()).map((n) => n.id)).toEqual(['n1'])

    const second = setup().notifications
    await second.load()
    expect(second.items.map((n) => n.id)).toEqual(['n1'])
  })
})

describe('notifications store — markRead／markAllRead', () => {
  function fakeSession() {
    return { access_token: 'token-123', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: 'me' } } as never
  }

  it('markRead 樂觀更新本地狀態，並呼叫 markNotificationRead', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    notifications.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
    ])

    await notifications.markRead('n1')

    expect(notifications.items[0]?.readAt).not.toBeNull()
    expect(clientMocks.markNotificationRead).toHaveBeenCalledWith('token-123', 'n1')
  })

  it('markRead 對已讀過的通知是no-op，不會重打網路', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    notifications.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: 5, createdAt: 1, updatedAt: 1 },
    ])

    await notifications.markRead('n1')

    expect(clientMocks.markNotificationRead).not.toHaveBeenCalled()
  })

  it('markRead 沒登入時什麼都不做', async () => {
    const { notifications } = setup()
    notifications.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
    ])

    await notifications.markRead('n1')

    expect(notifications.items[0]?.readAt).toBeNull()
    expect(clientMocks.markNotificationRead).not.toHaveBeenCalled()
  })

  it('markAllRead 把所有未讀都標成已讀', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    notifications.mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
      { id: 'n2', actorId: null, kind: 'assignment', taskId: 't1', body: '', readAt: null, createdAt: 2, updatedAt: 2 },
    ])

    await notifications.markAllRead()

    expect(notifications.unreadCount).toBe(0)
    expect(clientMocks.markAllNotificationsRead).toHaveBeenCalledWith('token-123')
  })

  it('markAllRead 沒有未讀時不打網路', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()

    await notifications.markAllRead()

    expect(clientMocks.markAllNotificationsRead).not.toHaveBeenCalled()
  })
})

describe('notifications store — 偏好設定', () => {
  function fakeSession() {
    return { access_token: 'token-123', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { id: 'me' } } as never
  }

  it('refreshPrefs 用伺服器回傳的值取代本地狀態', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    clientMocks.fetchNotificationPrefs.mockResolvedValue({
      notifyOnMention: false, notifyOnAssignment: true, dailyDigestEnabled: true,
    })

    await notifications.refreshPrefs()

    expect(notifications.prefs).toEqual({ notifyOnMention: false, notifyOnAssignment: true, dailyDigestEnabled: true })
  })

  it('setPref 樂觀更新，失敗時回滾並顯示錯誤', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    clientMocks.upsertNotificationPrefs.mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await notifications.setPref({ notifyOnMention: false })

    expect(notifications.prefs.notifyOnMention).toBe(true)
    expect(notifications.error).toBe('更新通知偏好失敗，請稍後再試一次')
  })

  it('setPref 成功時保留新值', async () => {
    const { notifications, auth } = setup()
    auth.session = fakeSession()
    clientMocks.upsertNotificationPrefs.mockResolvedValue(undefined)

    await notifications.setPref({ dailyDigestEnabled: true })

    expect(notifications.prefs.dailyDigestEnabled).toBe(true)
    expect(notifications.error).toBeNull()
  })
})
