import { SUPABASE_URL, VAPID_PUBLIC_KEY } from './config'
import { headers, safeText, SyncHttpError } from './restClient'

const TABLE = 'push_subscriptions'

/**
 * PushManager.subscribe() 的 applicationServerKey 要 Uint8Array，不是
 * base64url 字串——VAPID 公鑰照慣例存成 base64url（見
 * scripts/generate-vapid-keys.mjs），這裡轉換格式。
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // 不用 Uint8Array.from()：它的回傳型別在較新的 TS DOM lib 定義裡是
  // Uint8Array<ArrayBufferLike>（含 SharedArrayBuffer），跟
  // PushSubscriptionOptionsInit 要的 BufferSource 對不上。用建構子配
  // 固定長度再逐一填值，保證底層是真正的 ArrayBuffer。
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/**
 * 取得或註冊 Service Worker。
 * 包含逾時防護，避免在未註冊 worker 或特殊環境下 navigator.serviceWorker.ready 無限掛起。
 */
async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('此瀏覽器不支援 Service Worker')
  }

  // 若環境支援 getRegistration，先嘗試取得；若無註冊，則主動註冊 sw.js
  if (typeof navigator.serviceWorker.getRegistration === 'function') {
    const reg = await navigator.serviceWorker.getRegistration('./')
    if (!reg && typeof navigator.serviceWorker.register === 'function') {
      const swUrl = new URL('sw.js', document.baseURI).href
      await navigator.serviceWorker.register(swUrl, { scope: './' })
    }
  }

  if ('ready' in navigator.serviceWorker) {
    const readyPromise = navigator.serviceWorker.ready
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('等待 Service Worker 就緒逾時')), 5000),
    )
    return await Promise.race([readyPromise, timeoutPromise])
  }

  throw new Error('無法取得 Service Worker 註冊資訊')
}

/** 目前這個瀏覽器有沒有一組還在生效的推播訂閱——跟資料庫裡存的是否一致由呼叫端自己決定要不要同步。 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof window === 'undefined' ||
    !('PushManager' in window)
  ) {
    return null
  }

  // 避免在尚未註冊 Service Worker 時卡在 navigator.serviceWorker.ready
  if (typeof navigator.serviceWorker.getRegistration === 'function') {
    const reg = await navigator.serviceWorker.getRegistration('./')
    if (!reg) return null
    return await reg.pushManager.getSubscription()
  }

  if ('ready' in navigator.serviceWorker) {
    const registration = await navigator.serviceWorker.ready
    return registration.pushManager.getSubscription()
  }

  return null
}

/**
 * 跟瀏覽器要一組新的推播訂閱，並把 endpoint／金鑰存進 Supabase。
 * userVisibleOnly: true 是規範要求——不能訂閱推播卻不保證每次收到都會
 * 顯示看得到的通知，瀏覽器會直接拒絕沒有這個旗標的訂閱請求。
 */
export async function subscribeToPush(accessToken: string): Promise<void> {
  const registration = await getOrRegisterServiceWorker()
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })

  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('瀏覽器回傳的推播訂閱缺少必要欄位')
  }

  const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC'
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=user_id,endpoint`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(accessToken, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ endpoint: json.endpoint, p256dh, auth, timezone }]),
  })
  if (!res.ok) {
    // 存進資料庫失敗的話，訂閱留在瀏覽器端也沒有用——伺服器完全不知道
    // 要推給這個 endpoint，寧可整個動作失敗讓使用者重試，不要留一個
    // 「瀏覽器以為訂閱了，其實永遠收不到通知」的半吊子狀態。
    await subscription.unsubscribe()
    throw new SyncHttpError(TABLE, 'upsert', res.status, await safeText(res))
  }
}

/** 取消訂閱：瀏覽器端跟資料庫端都要清，缺一邊都會留下垃圾或誤導的狀態。 */
export async function unsubscribeFromPush(accessToken: string): Promise<void> {
  const subscription = await getExistingSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`
  const res = await fetch(url, { method: 'DELETE', headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(TABLE, 'delete', res.status, await safeText(res))
}
