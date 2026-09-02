import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getExistingSubscription, subscribeToPush, unsubscribeFromPush } from '@/sync/pushClient'
import { useAuthStore } from './auth'

/**
 * 推播通知的開關狀態（M4）。跟 composables/useDueReminders.ts 的到期
 * 提醒是兩回事：那個是分頁開著才會響的本地輪詢，這裡是被 @提及時就算
 * 分頁關著也收得到的真正推播。兩者刻意分開存在，不是同一個功能的
 * 兩種說法——UI（DataDialog.vue）並排顯示，文案也各自誠實描述自己
 * 能做到什麼、做不到什麼。
 */
export const usePushStore = defineStore('push', () => {
  const auth = useAuthStore()

  const subscribed = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const supported = computed(
    () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  )
  const permission = computed<NotificationPermission>(() => (supported.value ? Notification.permission : 'denied'))

  /** 開啟這個對話框時呼叫一次，讓畫面反映瀏覽器實際的訂閱狀態（可能在別的分頁被關掉過）。 */
  async function refresh(): Promise<void> {
    if (!supported.value) return
    subscribed.value = (await getExistingSubscription()) !== null
  }

  async function enable(): Promise<void> {
    if (!supported.value) return
    const token = auth.session?.access_token
    if (!token) return

    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      if (result !== 'granted') {
        error.value = '沒有取得瀏覽器的通知權限，無法開啟推播'
        return
      }
    } else if (Notification.permission === 'denied') {
      error.value = '瀏覽器已封鎖通知權限，請到瀏覽器的網站設定重新允許'
      return
    }

    loading.value = true
    error.value = null
    try {
      await subscribeToPush(token)
      subscribed.value = true
    } catch (e) {
      console.error('[push] 訂閱失敗', e)
      error.value = '開啟推播通知失敗，請稍後再試一次'
    } finally {
      loading.value = false
    }
  }

  async function disable(): Promise<void> {
    const token = auth.session?.access_token
    if (!token) return
    loading.value = true
    error.value = null
    try {
      await unsubscribeFromPush(token)
      subscribed.value = false
    } catch (e) {
      console.error('[push] 取消訂閱失敗', e)
      error.value = '關閉推播通知失敗，請稍後再試一次'
    } finally {
      loading.value = false
    }
  }

  return { subscribed, loading, error, supported, permission, refresh, enable, disable }
})
