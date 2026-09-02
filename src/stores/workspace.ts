import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  acceptInvitation,
  createInvitation,
  fetchMyWorkspaces,
  fetchPendingInvitations,
  fetchWorkspaceMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type InvitationRow,
  type MemberRole,
  type MemberRow,
  type WorkspaceRow,
} from '@/sync/workspaceClient'
import { useAuthStore } from './auth'

/**
 * 工作區、成員、待處理邀請。
 *
 * 跟 stores/sync.ts 同一個模式：自己 watch auth.status，登入就載入、
 * 登出就清空，不靠呼叫端記得在對的時機呼叫。sync/workspaceClient.ts
 * 只是 fetch 呼叫，沒有 authClient.ts／realtime.ts 那種重量級相依，
 * 所以這裡是一般的靜態 import，不需要動態載入。
 *
 * 目前沒有「切換工作區」的畫面——currentWorkspaceId 預設落在
 * is_personal 的那個，多工作區（使用者被邀進別人的工作區）時介面
 * 還是會抓到正確的清單與成員，只是還沒有 UI 讓使用者手動切換。
 * tasks／collections 的拉取也還沒依 workspace_id 篩選（見計畫書
 * M2 之後才要處理的範圍）——這裡先把「工作區本身」這一層資料備妥。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<WorkspaceRow[]>([])
  const currentWorkspaceId = ref<string | null>(null)
  const members = ref<MemberRow[]>([])
  const pendingInvitations = ref<InvitationRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const auth = useAuthStore()

  const currentWorkspace = computed(
    () => workspaces.value.find((w) => w.id === currentWorkspaceId.value) ?? null,
  )
  const myRole = computed<MemberRole | null>(() => {
    const userId = auth.session?.user.id
    if (!userId) return null
    return members.value.find((m) => m.user_id === userId)?.role ?? null
  })
  const canManageMembers = computed(() => myRole.value === 'owner' || myRole.value === 'admin')

  function accessToken(): string | null {
    return auth.session?.access_token ?? null
  }

  async function loadMembers(): Promise<void> {
    const token = accessToken()
    const workspaceId = currentWorkspaceId.value
    if (!token || !workspaceId) return
    // pendingInvitations 一律嘗試拉——RLS 已經把非管理者的查詢結果限制成
    // 空陣列，不需要在這裡先猜一次角色才決定要不要打這支請求。
    const [memberRows, invitationRows] = await Promise.all([
      fetchWorkspaceMembers(workspaceId, token),
      fetchPendingInvitations(workspaceId, token),
    ])
    members.value = memberRows
    pendingInvitations.value = invitationRows
  }

  async function load(): Promise<void> {
    const token = accessToken()
    if (!token) return
    loading.value = true
    error.value = null
    try {
      workspaces.value = await fetchMyWorkspaces(token)
      if (!currentWorkspaceId.value || !workspaces.value.some((w) => w.id === currentWorkspaceId.value)) {
        currentWorkspaceId.value = workspaces.value.find((w) => w.is_personal)?.id ?? workspaces.value[0]?.id ?? null
      }
      await loadMembers()
    } catch (e) {
      console.error('[workspace] 載入工作區失敗', e)
      error.value = '無法載入工作區資料，稍後會自動重試'
    } finally {
      loading.value = false
    }
  }

  function selectWorkspace(id: string): Promise<void> {
    currentWorkspaceId.value = id
    return loadMembers()
  }

  /** 回傳一次性邀請連結的 token（明文，只有這裡拿得到一次），失敗時回傳 null 並設定 error。 */
  async function invite(email: string, role: Exclude<MemberRole, 'owner'>): Promise<string | null> {
    const token = accessToken()
    const workspaceId = currentWorkspaceId.value
    if (!token || !workspaceId) return null
    error.value = null
    try {
      const inviteToken = await createInvitation(workspaceId, email, role, token)
      await loadMembers()
      return inviteToken
    } catch (e) {
      console.error('[workspace] 建立邀請失敗', e)
      error.value = '邀請沒有送出，請稍後再試一次'
      return null
    }
  }

  async function revoke(invitationId: string): Promise<void> {
    const token = accessToken()
    if (!token) return
    try {
      await revokeInvitation(invitationId, token)
      pendingInvitations.value = pendingInvitations.value.filter((i) => i.id !== invitationId)
    } catch (e) {
      console.error('[workspace] 撤銷邀請失敗', e)
      error.value = '撤銷失敗，請稍後再試一次'
    }
  }

  async function changeMemberRole(userId: string, role: MemberRole): Promise<void> {
    const token = accessToken()
    const workspaceId = currentWorkspaceId.value
    if (!token || !workspaceId) return
    try {
      await updateMemberRole(workspaceId, userId, role, token)
      await loadMembers()
    } catch (e) {
      console.error('[workspace] 變更角色失敗', e)
      error.value = '角色沒有更新成功，請稍後再試一次'
    }
  }

  async function removeMemberFromWorkspace(userId: string): Promise<void> {
    const token = accessToken()
    const workspaceId = currentWorkspaceId.value
    if (!token || !workspaceId) return
    try {
      await removeMember(workspaceId, userId, token)
      members.value = members.value.filter((m) => m.user_id !== userId)
    } catch (e) {
      console.error('[workspace] 移除成員失敗', e)
      error.value = '移除失敗，請稍後再試一次'
    }
  }

  /** 接受邀請連結裡的 token，成功後重新載入工作區清單並切到新加入的那個。 */
  async function acceptInvite(inviteToken: string): Promise<boolean> {
    const token = accessToken()
    if (!token) return false
    error.value = null
    try {
      const joinedWorkspaceId = await acceptInvitation(inviteToken, token)
      await load()
      currentWorkspaceId.value = joinedWorkspaceId
      await loadMembers()
      return true
    } catch (e) {
      console.error('[workspace] 接受邀請失敗', e)
      error.value = '這個邀請連結無法使用，可能已經過期或被撤銷'
      return false
    }
  }

  function clear(): void {
    workspaces.value = []
    currentWorkspaceId.value = null
    members.value = []
    pendingInvitations.value = []
    error.value = null
  }

  // 跟 stores/sync.ts 同一個理由：不管登入是在哪個分頁、用哪種方式完成的，
  // auth.status 一旦是 signed-in 就載入，變回 signed-out 就清空。
  watch(
    () => auth.status,
    (status) => {
      if (status === 'signed-in') void load()
      else clear()
    },
    { immediate: true },
  )

  return {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    members,
    pendingInvitations,
    myRole,
    canManageMembers,
    loading,
    error,
    load,
    selectWorkspace,
    invite,
    revoke,
    changeMemberRole,
    removeMemberFromWorkspace,
    acceptInvite,
  }
})
