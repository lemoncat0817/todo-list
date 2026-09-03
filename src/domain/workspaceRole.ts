import type { MemberRole } from '@/sync/workspaceClient'

/**
 * 工作區角色矩陣——跟 supabase/migrations/0004、0005 的
 * can_write_task()／can_comment()／can_manage_project() 同一組判斷，
 * 給畫面跟 store 在打 API 之前就停手。伺服器 RLS 仍是最後一道門；
 * 這裡只是不要讓僅檢視的人先改完、再看到「同步失敗」。
 *
 * currentWorkspaceId 為 null（純本機、尚未登入、工作區還沒載入）時
 * 全部放行：沒有工作區就沒有角色，行為跟同步功能加入之前一樣。
 */

const WRITE_TASK_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin', 'member'])
const COMMENT_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin', 'member', 'commenter'])
const MANAGE_PROJECT_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin'])
const MANAGE_MEMBER_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin'])

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: '擁有者',
  admin: '管理者',
  member: '成員',
  commenter: '僅留言',
  viewer: '僅檢視',
}

/** 僅檢視／僅留言時畫面上那句「為什麼不能改任務」。 */
export const TASK_WRITE_RESTRICTION_HINT: Record<'viewer' | 'commenter', string> = {
  viewer: '你目前是僅檢視，只能看任務，無法編輯或留言',
  commenter: '你目前是僅留言，可以留言但不能改任務',
}

export function canWriteTasks(role: MemberRole | null, currentWorkspaceId: string | null): boolean {
  if (currentWorkspaceId === null) return true
  if (role === null) return false
  return WRITE_TASK_ROLES.has(role)
}

/** 標籤／篩選器／附件／區段跟任務同一道門檻（見 0005_rls.sql）。 */
export function canWriteCollections(
  role: MemberRole | null,
  currentWorkspaceId: string | null,
): boolean {
  return canWriteTasks(role, currentWorkspaceId)
}

export function canComment(role: MemberRole | null, currentWorkspaceId: string | null): boolean {
  if (currentWorkspaceId === null) return true
  if (role === null) return false
  return COMMENT_ROLES.has(role)
}

export function canManageProjects(
  role: MemberRole | null,
  currentWorkspaceId: string | null,
): boolean {
  if (currentWorkspaceId === null) return true
  if (role === null) return false
  return MANAGE_PROJECT_ROLES.has(role)
}

export function canManageMembers(
  role: MemberRole | null,
  currentWorkspaceId: string | null,
): boolean {
  if (currentWorkspaceId === null) return false
  if (role === null) return false
  return MANAGE_MEMBER_ROLES.has(role)
}
