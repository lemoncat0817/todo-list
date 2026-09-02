// M4：每日摘要信——把過去 24 小時內、還沒讀的通知彙整成一封信。
//
// 由 supabase/migrations/0017_notifications.sql 的 pg_cron 排程
// （daily-digest，每天 09:00 UTC）透過 trigger_daily_digest() → pg_net
// 呼叫一次，這裡自己用 service role 查「誰開了每日摘要」再逐一寄送，
// 呼叫端不需要知道有哪些使用者——理由跟 send-task-notification 用
// x-webhook-secret 而非使用者 JWT 一樣：呼叫端是資料庫本身。
//
// 寄信用 Resend 的 REST API，不是 SDK：這裡只需要一支 POST，多引入一個
// 套件換不到什麼。挑 Resend 而不是走 Supabase 內建的 GoTrue 郵件服務，
// 是因為那個服務是「認證信」專用（AGENTS.md 記錄過的 over_email_send_rate_limit
// 坑——免費方案每小時只有個位數配額，本專案的登入信因此已經關掉），
// 每日摘要是完全獨立的交易性通知信，需要自己的寄送路徑，不能再擠同一個
// 本來就不夠用的配額。Resend 有免費自助方案、REST API 簡單到不需要 SDK，
// 跟當初選 Google／GitHub OAuth（免費自助主控台、不需要企業審核）是
// 同一種判斷。
//
// RESEND_API_KEY 沒設定時整支函式安靜跳過——跟 send-task-notification
// 的 VAPID 金鑰、notify_user() 的推播密鑰同一種「沒設定就不是壞掉，
// 是還沒接」處理方式。

const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Resend 要求寄件網域先驗證過，這裡只給一個佔位值，正式部署時要換成
// 真的驗證過的網域地址（見 Resend 主控台的 Domains 設定）。
const DIGEST_FROM_EMAIL = Deno.env.get('DIGEST_FROM_EMAIL') || 'digest@example.com'

const restHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }

interface PrefRow {
  user_id: string
}

interface NotificationRow {
  id: string
  kind: 'mention' | 'assignment'
  task_id: string
  detail: { body?: string } | null
}

interface TaskRow {
  id: string
  task_name: string
}

async function fetchDigestSubscribers(): Promise<PrefRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/notification_prefs?daily_digest_enabled=eq.true&select=user_id`
  const res = await fetch(url, { headers: restHeaders })
  if (!res.ok) throw new Error(`讀取摘要訂閱清單失敗（HTTP ${res.status}）：${await res.text()}`)
  return (await res.json()) as PrefRow[]
}

async function fetchUnreadSince(userId: string, sinceMs: number): Promise<NotificationRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${userId}&read_at=is.null` +
    `&created_at=gte.${sinceMs}&select=id,kind,task_id,detail&order=created_at.asc`
  const res = await fetch(url, { headers: restHeaders })
  if (!res.ok) throw new Error(`讀取未讀通知失敗（HTTP ${res.status}）：${await res.text()}`)
  return (await res.json()) as NotificationRow[]
}

async function fetchTaskNames(taskIds: readonly string[]): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map()
  const url = `${SUPABASE_URL}/rest/v1/tasks?id=in.(${taskIds.join(',')})&select=id,task_name`
  const res = await fetch(url, { headers: restHeaders })
  if (!res.ok) throw new Error(`讀取任務名稱失敗（HTTP ${res.status}）：${await res.text()}`)
  const rows = (await res.json()) as TaskRow[]
  return new Map(rows.map((r) => [r.id, r.task_name]))
}

/** GoTrue Admin API——PostgREST 不開放 auth.users，寄信要的信箱得從這裡查。 */
async function fetchUserEmail(userId: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/auth/v1/admin/users/${userId}`
  const res = await fetch(url, { headers: restHeaders })
  if (!res.ok) return null
  const body = (await res.json()) as { email?: string }
  return body.email ?? null
}

const KIND_LABEL: Record<NotificationRow['kind'], string> = {
  mention: '提到你',
  assignment: '指派給你',
}

function renderDigestHtml(items: readonly { taskName: string; label: string }[]): string {
  const rows = items
    .map((item) => `<li>${escapeHtml(item.taskName)} — ${escapeHtml(item.label)}</li>`)
    .join('')
  return `<p>過去一天有 ${items.length} 則新通知：</p><ul>${rows}</ul>`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function sendEmail(to: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: DIGEST_FROM_EMAIL, to, subject: '待辦事項：每日通知摘要', html }),
  })
  if (!res.ok) {
    console.error('[send-daily-digest] 寄信失敗', res.status, await res.text())
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }
  if (!RESEND_API_KEY) {
    return new Response('RESEND_API_KEY 未設定，跳過發送', { status: 200 })
  }

  const sinceMs = Date.now() - 24 * 60 * 60 * 1000
  const subscribers = await fetchDigestSubscribers()

  let sent = 0
  let skipped = 0
  for (const { user_id } of subscribers) {
    const unread = await fetchUnreadSince(user_id, sinceMs)
    if (unread.length === 0) {
      skipped++
      continue
    }
    const taskNames = await fetchTaskNames([...new Set(unread.map((n) => n.task_id))])
    const email = await fetchUserEmail(user_id)
    if (!email) {
      skipped++
      continue
    }
    const items = unread.map((n) => ({
      taskName: taskNames.get(n.task_id) ?? '（已刪除的任務）',
      label: KIND_LABEL[n.kind],
    }))
    await sendEmail(email, renderDigestHtml(items))
    sent++
  }

  return new Response(JSON.stringify({ sent, skipped }), { headers: { 'Content-Type': 'application/json' } })
})
