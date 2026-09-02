// M2 補做：邀請信真的寄出去，不是只能複製連結。
//
// 跟 send-task-notification／send-daily-digest 不一樣的地方：那兩支是
// 資料庫（trigger／pg_cron）用 x-webhook-secret 呼叫的，呼叫端是伺服器
// 本身；這支是使用者按下「邀請」當下，瀏覽器直接帶著自己的 Supabase
// session JWT 呼叫——所以驗證方式也不同，是重新核對「這個人真的有權限
// 管理這個工作區」，不是比對共用密鑰。
//
// 邀請連結本身（含一次性 token）由呼叫端（stores/workspace.ts）組好
// 傳進來，不是這支函式自己算——create_invitation() 回傳的明文 token
// 只在呼叫端拿得到一次，資料庫自己永遠只留得住雜湊（見
// supabase/migrations/0008_invitations.sql），這支函式也一樣拿不到，
// 沒有必要拿到：組信件只需要成品連結，不需要 token 本身。
//
// 寄信用 Resend 的 REST API，理由跟 send-daily-digest 同一份說明：
// Supabase 內建的 GoTrue 郵件服務是認證信專用、免費配額很緊，交易性
// 通知信需要自己的寄送路徑。RESEND_API_KEY 沒設定時安靜跳過，回傳
// sent:false——前端據此決定要不要提示「已寄出」，複製連結那個按鈕
// 不管有沒有寄信都留著，永遠是可靠的備援。

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INVITE_FROM_EMAIL = Deno.env.get('INVITE_FROM_EMAIL') || 'invitations@example.com'

interface InvitePayload {
  workspace_id: string
  workspace_name: string
  email: string
  role: string
  invite_link: string
  inviter_name: string
}

function isInvitePayload(value: unknown): value is InvitePayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.workspace_id === 'string' &&
    typeof v.workspace_name === 'string' &&
    typeof v.email === 'string' &&
    typeof v.role === 'string' &&
    typeof v.invite_link === 'string' &&
    typeof v.inviter_name === 'string'
  )
}

const ROLE_LABEL: Record<string, string> = {
  admin: '管理者',
  member: '成員',
  commenter: '僅留言',
  viewer: '僅檢視',
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderInviteHtml(payload: InvitePayload): string {
  const inviter = escapeHtml(payload.inviter_name || '有人')
  const workspace = escapeHtml(payload.workspace_name || '一個工作區')
  const role = ROLE_LABEL[payload.role] ?? payload.role
  return (
    `<p>${inviter} 邀請你加入「${workspace}」，角色是${escapeHtml(role)}。</p>` +
    `<p><a href="${payload.invite_link}">點這裡加入</a></p>` +
    `<p style="color:#888;font-size:12px">這個連結只能使用一次，7 天後失效。如果你不認識邀請你的人，可以忽略這封信。</p>`
  )
}

/**
 * 用呼叫者自己的 JWT（原樣轉發，不是 service role）重新核對權限——
 * 不然這支函式就會變成一個誰都能拿來對任意信箱亂發信的轉發器。
 * can_manage_workspace() 是既有的 RLS 判斷函式（見 0008 migration），
 * 這裡直接呼叫，不重新定義一次判斷邏輯。
 */
async function canManageWorkspace(workspaceId: string, authHeader: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_manage_workspace`, {
    method: 'POST',
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace: workspaceId }),
  })
  if (!res.ok) return false
  return (await res.json()) === true
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('unauthorized', { status: 401 })

  const payload: unknown = await req.json().catch(() => null)
  if (!isInvitePayload(payload)) return new Response('payload 形狀不對', { status: 400 })

  if (!(await canManageWorkspace(payload.workspace_id, authHeader))) {
    return new Response('沒有權限管理這個工作區', { status: 403 })
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ sent: false, reason: 'not_configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: INVITE_FROM_EMAIL,
      to: payload.email,
      subject: `${payload.inviter_name || '有人'} 邀請你加入「${payload.workspace_name || '一個工作區'}」`,
      html: renderInviteHtml(payload),
    }),
  })

  if (!res.ok) {
    console.error('[send-invitation-email] 寄信失敗', res.status, await res.text())
    return new Response(JSON.stringify({ sent: false, reason: 'send_failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } })
})
