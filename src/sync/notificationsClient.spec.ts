import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  markAllNotificationsRead,
  markNotificationRead,
  upsertNotificationPrefs,
} from './notificationsClient'

afterEach(() => vi.restoreAllMocks())

describe('fetchNotificationPrefs', () => {
  it('沒有偏好列時回傳預設值（全部開啟、摘要信關閉）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)
    await expect(fetchNotificationPrefs('token')).resolves.toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('有偏好列時正確改名回 camelCase', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ notify_on_mention: false, notify_on_assignment: true, daily_digest_enabled: true }],
    } as Response)
    await expect(fetchNotificationPrefs('token')).resolves.toEqual({
      notifyOnMention: false,
      notifyOnAssignment: true,
      dailyDigestEnabled: true,
    })
  })
})

describe('upsertNotificationPrefs', () => {
  it('只送真的有帶到的欄位，不會把其餘欄位一併覆蓋成 undefined', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)
    await upsertNotificationPrefs('token', { notifyOnMention: false })

    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/rest/v1/notification_prefs?on_conflict=user_id')
    expect(JSON.parse(String((options as RequestInit).body))).toEqual([{ notify_on_mention: false }])
  })
})

describe('markNotificationRead', () => {
  it('PATCH 指定 id，帶上 read_at', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)
    await markNotificationRead('token', 'n1')

    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/rest/v1/notifications?id=eq.n1')
    expect((options as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((options as RequestInit).body))).toHaveProperty('read_at')
  })
})

describe('markAllNotificationsRead', () => {
  it('用 read_at=is.null 篩選，不需要呼叫端自己蒐集 id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)
    await markAllNotificationsRead('token')

    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/rest/v1/notifications?read_at=is.null')
    expect((options as RequestInit).method).toBe('PATCH')
  })
})
