// M4：被 @提及時送出的 Web Push 通知。
//
// 由 supabase/migrations/0015_push_subscriptions.sql 的 comments_notify_mentions
// trigger（透過 pg_net）呼叫，不是給前端直接打的公開 API——用共用密鑰
// （x-webhook-secret，值存在 Vault，trigger 端跟這裡各自讀同一份）擋掉
// 未授權的呼叫，不是靠 Supabase 的使用者 JWT 驗證（呼叫端是資料庫本身，
// 沒有使用者 session 可以帶）。
//
// 用 npm:web-push 而不是手刻 Web Push 協定（VAPID JWT 簽章＋ECDH 金鑰
// 協議＋AES-GCM payload 加密，RFC 8291／8292）——這是這個專案目前唯一
// 一處用真正的密碼學協定跟外部服務對話，跟 sync/authClient.ts 用真正的
// @supabase/auth-js 而不是手刻 OAuth／PKCE 是同一個理由：協定本身的
// 正確性關乎能不能送達、會不會洩漏，不是「省一點 bundle 大小」划算的地方
// ——而且這裡完全不影響前端 bundle，只跑在 Deno 這一端。
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  // mailto: 是 VAPID 規範要求的聯絡資訊，推播服務（FCM 等）在金鑰被
  // 濫用時會用這個聯絡開發者——這裡放一個佔位信箱，正式部署時應該換成
  // 真的收得到信的地址。
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

interface MentionPayload {
  user_id: string
  comment_id: string
  task_id: string
  body: string
}

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

function isMentionPayload(value: unknown): value is MentionPayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.user_id === 'string' &&
    typeof v.comment_id === 'string' &&
    typeof v.task_id === 'string' &&
    typeof v.body === 'string'
  )
}

/** 留言內容截斷成通知摘要——推播的顯示空間有限，不需要整段留言。 */
function summarize(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
}

async function fetchSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=id,endpoint,p256dh,auth`
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`讀取推播訂閱失敗（HTTP ${res.status}）：${await res.text()}`)
  return (await res.json()) as PushSubscriptionRow[]
}

/** 推播端點回報「這組訂閱已經失效」時的狀態碼——順手清掉，不然每次都會白送一次。 */
const EXPIRED_STATUS = new Set([404, 410])

async function deleteSubscription(id: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${id}`
  await fetch(url, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response('VAPID 金鑰未設定，跳過發送', { status: 200 })
  }

  const payload: unknown = await req.json().catch(() => null)
  if (!isMentionPayload(payload)) {
    return new Response('payload 形狀不對', { status: 400 })
  }

  const subscriptions = await fetchSubscriptions(payload.user_id)
  const notification = JSON.stringify({
    title: '有人在留言裡提到你',
    body: summarize(payload.body),
    taskId: payload.task_id,
  })

  // 三種結果分開算：expired 是「這組訂閱本來就該清掉」，不是發送失敗，
  // 混進 sent 或 failed 都會讓呼叫端看到誤導的數字。
  type Outcome = 'sent' | 'expired' | 'failed'
  const outcomes = await Promise.all(
    subscriptions.map(async (sub): Promise<Outcome> => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
        )
        return 'sent'
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status !== undefined && EXPIRED_STATUS.has(status)) {
          await deleteSubscription(sub.id)
          return 'expired'
        }
        console.error('[send-mention-push] 發送失敗', error)
        return 'failed'
      }
    }),
  )

  const summary = {
    sent: outcomes.filter((o) => o === 'sent').length,
    expired: outcomes.filter((o) => o === 'expired').length,
    failed: outcomes.filter((o) => o === 'failed').length,
  }
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } })
})
