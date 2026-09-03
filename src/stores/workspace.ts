import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { SyncHttpError } from '@/sync/restClient'
import {
  acceptInvitation,
  createInvitation,
  fetchMyWorkspaces,
  fetchPendingInvitations,
  fetchWorkspaceMembers,
  removeMember,
  revokeInvitation,
  sendInvitationEmail,
  updateMemberRole,
  type InvitationRow,
  type MemberRole,
  type MemberRow,
  type WorkspaceRow,
} from '@/sync/workspaceClient'
import {
  canComment as roleCanComment,
  canManageMembers as roleCanManageMembers,
  canManageProjects as roleCanManageProjects,
  canWriteCollections as roleCanWriteCollections,
  canWriteTasks as roleCanWriteTasks,
} from '@/domain/workspaceRole'
import { pickCurrentWorkspaceId } from '@/domain/pickWorkspace'
import { useAuthStore } from './auth'

/**
 * PT004（supabase/migrations/0021_workspace_member_cap.sql）是唯一目前
 * 會從 create_invitation()／accept_invitation() 冒出來的自訂錯誤代碼，
 * 不管哪一邊觸發，使用者看到的說法是同一句——「成員已滿」本身就是完整
 * 的原因，不需要因為觸發點是「邀請」還是「接受」而分兩種講法。
 */
function describeWorkspaceError(e: unknown, fallback: string): string {
  if (e instanceof SyncHttpError && (e.code === 'PT004' || e.code === 'WS004')) {
    return '這個工作區的成員已經滿了，請聯絡工作區管理者'
  }
  return fallback
}

const PENDING_INVITE_KEY = 'todoTask:pendingInvite'
/** 依帳號記住上次選的工作區，避免 reload 又落到別人的個人工作區。 */
const CURRENT_WORKSPACE_KEY_PREFIX = 'todoTask:currentWorkspace:'

/**
 * 邀請連結被點開時，使用者不一定已經登入——OAuth 的登入流程會整頁導去
 * 供應商再導回來，中途沒有機制讓網址上的 `?token=` query 原封不動存活
 * （PKCE 流程回來時網址會換成 `?code=`，見 AGENTS.md 對 sync/authClient.ts
 * 的說明）。所以邀請連結的畫面（AcceptInviteView.vue）看到還沒登入時，
 * 先把 token 存進 localStorage 再引導登入；登入完成後，不管使用者最後
 * 回到哪個路由，都靠下面 auth.status 的 watcher 自動撿起來處理，不需要
 * 邀請連結那個路由本身在登入完成時還活著。
 */
export function storePendingInviteToken(token: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, token)
  } catch {
    // 存取被擋時（無痕模式、Cookie 停用）就只能要求使用者登入後重新點一次連結
  }
}

function consumePendingInviteToken(): string | null {
  try {
    const token = localStorage.getItem(PENDING_INVITE_KEY)
    if (token !== null) localStorage.removeItem(PENDING_INVITE_KEY)
    return token
  } catch {
    return null
  }
}

function rememberedWorkspaceKey(userId: string): string {
  return `${CURRENT_WORKSPACE_KEY_PREFIX}${userId}`
}

function readRememberedWorkspaceId(userId: string): string | null {
  try {
    return localStorage.getItem(rememberedWorkspaceKey(userId))
  } catch {
    return null
  }
}

function writeRememberedWorkspaceId(userId: string, workspaceId: string): void {
  try {
    localStorage.setItem(rememberedWorkspaceKey(userId), workspaceId)
  } catch {
    // 同 pending invite：無痕／停用 cookie 時只影響「記住上次選哪個」
  }
}

/**
 * 工作區、成員、待處理邀請。
 *
 * 跟 stores/sync.ts 同一個模式：自己 watch auth.status，登入就載入、
 * 登出就清空，不靠呼叫端記得在對的時機呼叫。sync/workspaceClient.ts
 * 只是 fetch 呼叫，沒有 authClient.ts／realtime.ts 那種重量級相依，
 * 所以這裡是一般的靜態 import，不需要動態載入。
 *
 * 目前所在工作區：切換時寫進 localStorage（依 user id），reload 後還原；
 * 沒有記住的值時，挑「自己建立的個人工作區」，不是任意 is_personal——
 * 被邀進別人的個人工作區時對方那列也是 is_personal，以前會踩到。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<WorkspaceRow[]>([])
  const currentWorkspaceId = ref<string | null>(null)
  const members = ref<MemberRow[]>([])
  const pendingInvitations = ref<InvitationRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /**
   * 線上狀態（M3）：workspaceId → 目前透過 Realtime presence 回報在線的
   * user id 集合。由 stores/sync.ts 的 reconcileRealtimeSubscriptions()
   * 寫入（見 sync/realtime.ts 的 onPresenceChange），這個 store 只負責
   * 存著給畫面讀，不自己碰 Realtime。
   */
  const onlineUserIdsByWorkspace = ref<Record<string, string[]>>({})

  const auth = useAuthStore()

  const currentWorkspace = computed(
    () => workspaces.value.find((w) => w.id === currentWorkspaceId.value) ?? null,
  )
  const myRole = computed<MemberRole | null>(() => {
    const userId = auth.session?.user.id
    if (!userId) return null
    return members.value.find((m) => m.user_id === userId)?.role ?? null
  })
  const canWriteTasks = computed(() => roleCanWriteTasks(myRole.value, currentWorkspaceId.value))
  const canWriteCollections = computed(() =>
    roleCanWriteCollections(myRole.value, currentWorkspaceId.value),
  )
  const canComment = computed(() => roleCanComment(myRole.value, currentWorkspaceId.value))
  const canManageProjects = computed(() =>
    roleCanManageProjects(myRole.value, currentWorkspaceId.value),
  )
  const canManageMembers = computed(() =>
    roleCanManageMembers(myRole.value, currentWorkspaceId.value),
  )
  /** 僅檢視／僅留言時給畫面顯示為什麼不能改任務；能寫時是 null。 */
  const taskWriteRestriction = computed<'viewer' | 'commenter' | null>(() => {
    if (myRole.value === 'viewer') return 'viewer'
    if (myRole.value === 'commenter') return 'commenter'
    return null
  })
  /** 目前所在工作區的線上成員 id——MembersDialog.vue 顯示綠點用這個。 */
  const onlineUserIds = computed(() => {
    const workspaceId = currentWorkspaceId.value
    if (!workspaceId) return new Set<string>()
    return new Set(onlineUserIdsByWorkspace.value[workspaceId] ?? [])
  })

  function setOnlineUsers(workspaceId: string, userIds: readonly string[]): void {
    onlineUserIdsByWorkspace.value = { ...onlineUserIdsByWorkspace.value, [workspaceId]: [...userIds] }
  }

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
        const userId = auth.session?.user.id ?? null
        currentWorkspaceId.value = pickCurrentWorkspaceId(workspaces.value, {
          userId,
          rememberedId: userId ? readRememberedWorkspaceId(userId) : null,
        })
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
    const userId = auth.session?.user.id
    if (userId) writeRememberedWorkspaceId(userId, id)
    return loadMembers()
  }

  /**
   * 建立邀請連結，並盡量把信寄出去（M2 補做）。回傳的連結永遠是可靠的
   * ——不管信有沒有寄出，複製連結都要能用；`emailSent` 只是給畫面決定
   * 要不要多顯示一句「已寄出邀請信」，不是唯一的成功指標。
   *
   * 連結在這裡組（不是留給 MembersDialog.vue），因為寄信跟複製連結
   * 用的必須是同一個字串，兩邊各自組一次容易兜不起來。
   */
  async function invite(
    email: string,
    role: Exclude<MemberRole, 'owner'>,
  ): Promise<{ link: string; emailSent: boolean } | null> {
    const token = accessToken()
    const workspaceId = currentWorkspaceId.value
    if (!token || !workspaceId) return null
    error.value = null
    try {
      const inviteToken = await createInvitation(workspaceId, email, role, token)
      await loadMembers()
      const link = `${location.origin}${location.pathname}#/accept-invite?token=${inviteToken}`

      let emailSent = false
      try {
        const myUserId = auth.session?.user.id
        const inviterName = members.value.find((m) => m.user_id === myUserId)?.profiles?.display_name ?? ''
        emailSent = await sendInvitationEmail(
          {
            workspaceId,
            workspaceName: currentWorkspace.value?.name ?? '',
            email,
            role,
            inviteLink: link,
            inviterName,
          },
          token,
        )
      } catch (e) {
        // 寄信失敗不影響邀請本身——連結已經建立好了，使用者永遠可以
        // 自己複製傳送，不用因為寄信這一步失敗就讓整個邀請動作跟著報錯。
        console.error('[workspace] 寄送邀請信失敗，改用複製連結', e)
      }

      return { link, emailSent }
    } catch (e) {
      console.error('[workspace] 建立邀請失敗', e)
      error.value = describeWorkspaceError(e, '邀請沒有送出，請稍後再試一次')
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
  /**
   * 同一個 token 可能被兩個地方幾乎同時呼叫：AcceptInviteView.vue 自己
   * 的 watcher，跟下面 auth.status 的 watcher（consumePendingInviteToken
   * 撿到 localStorage 裡剛存的 token）——使用者開連結時剛好卡在
   * auth.restore() 還沒跑完的那個瞬間就會兩邊都觸發。accept_invitation
   * 本身不是 op_id 那種能重送的去重（那是 outbox 專用的機制），同一個
   * token 呼叫兩次，第二次會撞到「已經被使用過」而回報失敗，即使第一次
   * 其實成功了。用跟 tasks.ts 的 flush()／sync.ts 的 syncOnce() 一樣的
   * in-flight 寫法：同一個 token 的第二次呼叫直接共用第一次的 promise。
   */
  let acceptInFlight: { token: string; promise: Promise<boolean> } | null = null

  function acceptInvite(inviteToken: string): Promise<boolean> {
    if (acceptInFlight && acceptInFlight.token === inviteToken) return acceptInFlight.promise

    const token = accessToken()
    if (!token) return Promise.resolve(false)
    error.value = null

    const promise = (async () => {
      try {
        const joinedWorkspaceId = await acceptInvitation(inviteToken, token)
        await load()
        currentWorkspaceId.value = joinedWorkspaceId
        const userId = auth.session?.user.id
        if (userId) writeRememberedWorkspaceId(userId, joinedWorkspaceId)
        await loadMembers()
        return true
      } catch (e) {
        console.error('[workspace] 接受邀請失敗', e)
        error.value = describeWorkspaceError(e, '這個邀請連結無法使用，可能已經過期或被撤銷')
        return false
      } finally {
        acceptInFlight = null
      }
    })()
    acceptInFlight = { token: inviteToken, promise }
    return promise
  }

  function clear(): void {
    workspaces.value = []
    currentWorkspaceId.value = null
    members.value = []
    pendingInvitations.value = []
    error.value = null
    onlineUserIdsByWorkspace.value = {}
  }

  // 跟 stores/sync.ts 同一個理由：不管登入是在哪個分頁、用哪種方式完成的，
  // auth.status 一旦是 signed-in 就載入，變回 signed-out 就清空。
  watch(
    () => auth.status,
    (status) => {
      if (status === 'signed-in') {
        void load()
        const pendingToken = consumePendingInviteToken()
        if (pendingToken) void acceptInvite(pendingToken)
      } else {
        clear()
      }
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
    canWriteTasks,
    canWriteCollections,
    canComment,
    canManageProjects,
    canManageMembers,
    taskWriteRestriction,
    onlineUserIds,
    setOnlineUsers,
    loading,
    error,
    load,
    loadMembers,
    selectWorkspace,
    invite,
    revoke,
    changeMemberRole,
    removeMemberFromWorkspace,
    acceptInvite,
  }
})
