import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadNotifications, saveNotifications } from '@/db'
import type { StoredNotification } from '@/db/schema'
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  markAllNotificationsRead,
  markNotificationRead,
  upsertNotificationPrefs,
  type NotificationPrefs,
} from '@/sync/notificationsClient'
import { useAuthStore } from './auth'

/**
 * 通知中心（M4）。跟 activity.ts 同一種形狀——通知列表完全唯讀，只有
 * mergeRemote()／persist()，沒有 add/update；「標已讀」跟「偏好設定」
 * 是另外兩件事，各自直接打網路（見 sync/notificationsClient.ts 開頭
 * 的說明），不經過 outbox。
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<StoredNotification[]>([])
  const prefs = ref<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS)
  const error = ref<string | null>(null)

  const sorted = computed(() => [...items.value].sort((a, b) => b.createdAt - a.createdAt))
  const unreadCount = computed(() => items.value.filter((n) => n.readAt === null).length)

  async function load(): Promise<void> {
    items.value = await loadNotifications()
  }

  /** toRaw 不需要：StoredNotification 沒有巢狀物件欄位（跟 comments/activity 的 detail 不同）。 */
  async function persist(): Promise<void> {
    await saveNotifications(items.value)
  }

  function mergeRemote(rows: readonly StoredNotification[]): void {
    const byId = new Map(items.value.map((n) => [n.id, n]))
    for (const row of rows) byId.set(row.id, row)
    items.value = [...byId.values()]
  }

  /** DataDialog 開啟時呼叫，跟 push.refresh() 同一種「開對話框才重新問一次伺服器」節奏。 */
  async function refreshPrefs(): Promise<void> {
    const token = auth().session?.access_token
    if (!token) return
    try {
      prefs.value = await fetchNotificationPrefs(token)
    } catch (err) {
      console.error('[notifications] 讀取通知偏好失敗', err)
    }
  }

  async function setPref(patch: Partial<NotificationPrefs>): Promise<void> {
    const token = auth().session?.access_token
    if (!token) return
    const before = prefs.value
    // 樂觀更新：偏好設定的失敗機率低、影響範圍只有自己，不值得讓使用者
    // 等網路來回才看到勾選框反應。
    prefs.value = { ...prefs.value, ...patch }
    try {
      await upsertNotificationPrefs(token, patch)
      error.value = null
    } catch (err) {
      prefs.value = before
      error.value = '更新通知偏好失敗，請稍後再試一次'
      console.error('[notifications] 更新通知偏好失敗', err)
    }
  }

  async function markRead(id: string): Promise<void> {
    const target = items.value.find((n) => n.id === id)
    if (!target || target.readAt !== null) return
    const token = auth().session?.access_token
    if (!token) return
    const now = Date.now()
    items.value = items.value.map((n) => (n.id === id ? { ...n, readAt: now, updatedAt: now } : n))
    void persist()
    try {
      await markNotificationRead(token, id)
    } catch (err) {
      console.error('[notifications] 標記已讀失敗', err)
      // 不回滾：本地已讀狀態就算沒推上去，下一輪拉取如果伺服器仍是未讀
      // 也只是使用者看到的紅點慢一拍變化，不是資料正確性問題，不值得
      // 為此把已經點開看過的東西又標回未讀嚇使用者一跳。
    }
  }

  async function markAllRead(): Promise<void> {
    const token = auth().session?.access_token
    if (!token || unreadCount.value === 0) return
    const now = Date.now()
    items.value = items.value.map((n) => (n.readAt === null ? { ...n, readAt: now, updatedAt: now } : n))
    void persist()
    try {
      await markAllNotificationsRead(token)
    } catch (err) {
      console.error('[notifications] 全部標記已讀失敗', err)
    }
  }

  // 延遲取得，避免模組載入順序造成的循環依賴（跟 stores/sync.ts 內部
  // 呼叫 useAuthStore() 的方式一致，這裡包一層函式只是省得每個動作
  // 自己重複 import 呼叫）。
  function auth() {
    return useAuthStore()
  }

  return { items, sorted, prefs, unreadCount, error, load, persist, mergeRemote, refreshPrefs, setPref, markRead, markAllRead }
})
