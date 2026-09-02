import { SUPABASE_URL } from './config'
import { SyncHttpError, headers, safeText } from './restClient'

/**
 * 工作區／成員／邀請的 REST＋RPC 呼叫層。跟 sync/rpc.ts 分開——那支是
 * outbox 上傳器專用（依 Op 型別、drainOutbox() 呼叫），這裡是給還沒有
 * 資料要送的「唯讀查詢」與「使用者主動觸發的一次性動作」（邀請、
 * 加入、踢除成員），形狀完全不同，硬塞進同一支只會互相遷就。
 *
 * PostgREST 的 embedding（?select=*,profiles(*)）需要兩張表之間有直接
 * 外鍵——workspace_members.user_id 原本只參照 auth.users(id)，跟
 * profiles 沒有直接關聯，查不到顯示名稱（PGRST200）。這裡假設
 * supabase/migrations/0009_member_profile_fk.sql 已經補上那條外鍵，
 * 實際打過本地 REST API 驗證過，不是憑文件猜的。
 */

export interface WorkspaceRow {
  id: string
  name: string
  is_personal: boolean
  created_by: string
  updated_at: number
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'commenter' | 'viewer'

export interface MemberRow {
  user_id: string
  role: MemberRole
  joined_at: string
  profiles: { display_name: string; avatar_url: string | null } | null
}

export interface InvitationRow {
  id: string
  email: string
  role: MemberRole
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

async function get<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'GET', headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(path, 'fetch', res.status, await safeText(res))
  return (await res.json()) as T
}

async function rpc<T>(fn: string, params: Record<string, unknown>, accessToken: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new SyncHttpError(fn, 'rpc', res.status, await safeText(res))
  return (await res.json()) as T
}

/** 目前使用者看得到的所有工作區——RLS 已經把範圍限定在自己是成員的那些。 */
export function fetchMyWorkspaces(accessToken: string): Promise<WorkspaceRow[]> {
  return get('workspaces?select=*', accessToken)
}

/** 一個工作區的成員名單，附上各自的顯示名稱。 */
export function fetchWorkspaceMembers(workspaceId: string, accessToken: string): Promise<MemberRow[]> {
  return get(
    `workspace_members?workspace_id=eq.${workspaceId}&select=user_id,role,joined_at,profiles(display_name,avatar_url)`,
    accessToken,
  )
}

/** 還在等待接受的邀請——只有 workspace admin/owner 看得到，RLS 已經擋掉其他人。 */
export function fetchPendingInvitations(workspaceId: string, accessToken: string): Promise<InvitationRow[]> {
  return get(
    `invitations?workspace_id=eq.${workspaceId}&accepted_at=is.null&revoked_at=is.null&select=id,email,role,created_at,expires_at,accepted_at,revoked_at`,
    accessToken,
  )
}

/**
 * 建立邀請，回傳一次性 token（明文，只有這裡拿得到，資料庫只留雜湊）。
 * 呼叫端要把它組進信件連結——實際寄信是 Edge Function 的責任，
 * 這支只負責「跟資料庫要一個 token」。
 */
export function createInvitation(
  workspaceId: string,
  email: string,
  role: Exclude<MemberRole, 'owner'>,
  accessToken: string,
): Promise<string> {
  return rpc('create_invitation', { p_workspace_id: workspaceId, p_email: email, p_role: role }, accessToken)
}

export async function revokeInvitation(invitationId: string, accessToken: string): Promise<void> {
  await rpc('revoke_invitation', { p_invitation_id: invitationId }, accessToken)
}

/**
 * 呼叫 send-invitation-email edge function（M2 補做，見該函式開頭的
 * 說明）。回傳的 `sent` 反映實際有沒有寄出——RESEND_API_KEY 沒設定時
 * 函式本身安靜跳過，回傳 sent:false，不是拋錯。呼叫端據此決定要不要
 * 提示「已寄出邀請信」，複製連結那個按鈕不管有沒有寄信都要留著。
 */
export async function sendInvitationEmail(
  params: {
    workspaceId: string
    workspaceName: string
    email: string
    role: Exclude<MemberRole, 'owner'>
    inviteLink: string
    inviterName: string
  },
  accessToken: string,
): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-invitation-email`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({
      workspace_id: params.workspaceId,
      workspace_name: params.workspaceName,
      email: params.email,
      role: params.role,
      invite_link: params.inviteLink,
      inviter_name: params.inviterName,
    }),
  })
  if (!res.ok) throw new SyncHttpError('send-invitation-email', 'rpc', res.status, await safeText(res))
  const body = (await res.json()) as { sent: boolean }
  return body.sent
}

/** 接受邀請，回傳加入的工作區 id。 */
export function acceptInvitation(token: string, accessToken: string): Promise<string> {
  return rpc('accept_invitation', { p_token: token }, accessToken)
}

/** 變更成員角色（限 owner/admin，RLS 把關）。 */
export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: MemberRole,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: headers(accessToken, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ role }),
    },
  )
  if (!res.ok) throw new SyncHttpError('workspace_members', 'upsert', res.status, await safeText(res))
}

/** 移除成員（限 owner/admin，RLS 把關；不能把自己踢出去這件事由呼叫端的 UI 擋，不是這裡的責任）。 */
export async function removeMember(workspaceId: string, userId: string, accessToken: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${userId}`,
    { method: 'DELETE', headers: headers(accessToken, { Prefer: 'return=minimal' }) },
  )
  if (!res.ok) throw new SyncHttpError('workspace_members', 'delete', res.status, await safeText(res))
}
