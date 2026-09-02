import { SUPABASE_URL } from './config'
import { headers, safeText, SyncHttpError } from './restClient'

/**
 * 通知列表本身走 sync/tableSync.ts 既有的拉取＋合併機制（見 stores/sync.ts
 * 的 notificationBinding，跟 activity_log 同一種「純拉取，沒有 outbox」
 * 表）。這裡另外處理兩件那條路徑覆蓋不到的事：
 *   - 標已讀：使用者主動的寫入，不是伺服器產生的資料，不透過拉取合併。
 *   - 通知偏好：notification_prefs 是單列（一個使用者一列，PK 是
 *     user_id 不是 id），不符合 fetchRowsSince 假設的「id + updated_at
 *     游標」表形狀，直接查詢／upsert 比硬塞進那套機制單純。
 */

const TABLE_PREFS = 'notification_prefs'
const TABLE_NOTIFICATIONS = 'notifications'

export interface NotificationPrefs {
  notifyOnMention: boolean
  notifyOnAssignment: boolean
  dailyDigestEnabled: boolean
}

/** 跟資料庫端 notify_user() 的 coalesce(..., true) 邏輯一致：沒有偏好列代表沿用預設值。 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  notifyOnMention: true,
  notifyOnAssignment: true,
  dailyDigestEnabled: false,
}

export async function fetchNotificationPrefs(accessToken: string): Promise<NotificationPrefs> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_PREFS}?select=notify_on_mention,notify_on_assignment,daily_digest_enabled`
  const res = await fetch(url, { headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(TABLE_PREFS, 'fetch', res.status, await safeText(res))
  const rows = (await res.json()) as Record<string, unknown>[]
  const row = rows[0]
  if (!row) return DEFAULT_NOTIFICATION_PREFS
  return {
    notifyOnMention: row.notify_on_mention !== false,
    notifyOnAssignment: row.notify_on_assignment !== false,
    dailyDigestEnabled: row.daily_digest_enabled === true,
  }
}

/** 只送真的變動的欄位——跟 apply_task_patch 那套補丁邏輯同樣的理由：不動的欄位不該被覆蓋成預設值。 */
export async function upsertNotificationPrefs(accessToken: string, patch: Partial<NotificationPrefs>): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.notifyOnMention !== undefined) body.notify_on_mention = patch.notifyOnMention
  if (patch.notifyOnAssignment !== undefined) body.notify_on_assignment = patch.notifyOnAssignment
  if (patch.dailyDigestEnabled !== undefined) body.daily_digest_enabled = patch.dailyDigestEnabled

  const url = `${SUPABASE_URL}/rest/v1/${TABLE_PREFS}?on_conflict=user_id`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(accessToken, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([body]),
  })
  if (!res.ok) throw new SyncHttpError(TABLE_PREFS, 'upsert', res.status, await safeText(res))
}

export async function markNotificationRead(accessToken: string, id: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_NOTIFICATIONS}?id=eq.${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers(accessToken, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ read_at: Date.now() }),
  })
  if (!res.ok) throw new SyncHttpError(TABLE_NOTIFICATIONS, 'upsert', res.status, await safeText(res))
}

/** 過濾條件是 read_at=is.null，不是帶一串 id——RLS 本來就只認得到自己的列，不需要呼叫端自己蒐集 id。 */
export async function markAllNotificationsRead(accessToken: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_NOTIFICATIONS}?read_at=is.null`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers(accessToken, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ read_at: Date.now() }),
  })
  if (!res.ok) throw new SyncHttpError(TABLE_NOTIFICATIONS, 'upsert', res.status, await safeText(res))
}
