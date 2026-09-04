import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import AppSidebar from '@/components/AppSidebar.vue'
import MembersDialog from '@/components/MembersDialog.vue'
import AcceptInviteView from '@/components/AcceptInviteView.vue'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useAuthStore } from '@/stores/auth'
import { pickCurrentWorkspaceId } from '@/domain/pickWorkspace'
import { freshPinia, mountWith, makeTask, testRouter } from '@/test/helpers'

function fakeSession(userId = 'u1', email = 'alice@example.com'): Session {
  return {
    access_token: 'token-123',
    refresh_token: 'refresh-123',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email },
  } as unknown as Session
}

function mockFetch(handler: (url: string) => { ok?: boolean; status?: number; data: unknown }) {
  const impl = async (url: unknown) => {
    const res = handler(String(url))
    const ok = res.ok ?? (res.status ? res.status >= 200 && res.status < 300 : true)
    const status = res.status ?? (ok ? 200 : 400)
    const text = res.data === undefined ? '' : JSON.stringify(res.data)
    return {
      ok,
      status,
      json: async () => res.data,
      text: async () => text,
    } as Response
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(impl)
  if (typeof window !== 'undefined' && 'fetch' in window) {
    vi.spyOn(window, 'fetch').mockImplementation(impl)
  }
}

describe('工作區與成員（M0／M2）驗證清單', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 1. 側邊欄切換工作區後，任務／專案／標籤／篩選器只顯示該區
  it('1. 側邊欄切換工作區後，任務／專案／標籤／篩選器只顯示該區', async () => {
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return {
          data: [
            { id: 'w1', name: '工作區 1', is_personal: true, created_by: 'u1', updated_at: 1 },
            { id: 'w2', name: '工作區 2', is_personal: false, created_by: 'u2', updated_at: 1 },
          ],
        }
      }
      if (url.includes('/workspace_members?')) {
        return {
          data: [{ user_id: 'u1', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } }],
        }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    const tasks = useTasksStore()
    const collections = useCollectionsStore()

    auth.session = fakeSession('u1')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
    expect(workspace.currentWorkspaceId).toBe('w1')

    // 加入 w1 與 w2 的任務
    tasks.items = [
      makeTask('任務 1-A', false, { id: 't1', workspaceId: 'w1' }),
      makeTask('任務 1-B', false, { id: 't2', workspaceId: 'w1' }),
      makeTask('任務 2-A', false, { id: 't3', workspaceId: 'w2' }),
    ]

    // 加入 w1 與 w2 的專案、標籤、篩選器
    collections.mergeRemote({
      projects: [
        { id: 'p1', name: '專案一', color: '#ff0000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'w1' },
        { id: 'p2', name: '專案二', color: '#00ff00', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: 'w2' },
      ],
      tags: [
        { id: 'tag1', name: '標籤一', color: '#ff0000', updatedAt: 1, workspaceId: 'w1' },
        { id: 'tag2', name: '標籤二', color: '#00ff00', updatedAt: 1, workspaceId: 'w2' },
      ],
      filters: [
        { id: 'f1', name: '篩選器一', query: 'p1', color: '#ff0000', rank: 'A', updatedAt: 1, workspaceId: 'w1' },
        { id: 'f2', name: '篩選器二', query: 'p2', color: '#00ff00', rank: 'B', updatedAt: 1, workspaceId: 'w2' },
      ],
    })

    const router = testRouter()
    const sidebar = mountWith(AppSidebar, pinia, { router })
    await sidebar.vm.$nextTick()

    // 處於 w1 時：任務僅 2 筆，專案只有「專案一」，標籤只有「#標籤一」，篩選器只有「篩選器一」
    expect(tasks.visibleItems.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(collections.visibleProjects.map((p) => p.name)).toEqual(['專案一'])
    expect(collections.visibleTags.map((t) => t.name)).toEqual(['標籤一'])
    expect(collections.visibleFilters.map((f) => f.name)).toEqual(['篩選器一'])

    expect(sidebar.text()).toContain('專案一')
    expect(sidebar.text()).not.toContain('專案二')
    expect(sidebar.text()).toContain('#標籤一')
    expect(sidebar.text()).not.toContain('#標籤二')
    expect(sidebar.text()).toContain('篩選器一')
    expect(sidebar.text()).not.toContain('篩選器二')

    // 切換到 w2
    await workspace.selectWorkspace('w2')
    await sidebar.vm.$nextTick()

    expect(workspace.currentWorkspaceId).toBe('w2')
    // 處於 w2 時：任務僅 1 筆，專案只有「專案二」，標籤只有「#標籤二」，篩選器只有「篩選器二」
    expect(tasks.visibleItems.map((t) => t.id)).toEqual(['t3'])
    expect(collections.visibleProjects.map((p) => p.name)).toEqual(['專案二'])
    expect(collections.visibleTags.map((t) => t.name)).toEqual(['標籤二'])
    expect(collections.visibleFilters.map((f) => f.name)).toEqual(['篩選器二'])

    expect(sidebar.text()).not.toContain('專案一')
    expect(sidebar.text()).toContain('專案二')
    expect(sidebar.text()).not.toContain('#標籤一')
    expect(sidebar.text()).toContain('#標籤二')
    expect(sidebar.text()).not.toContain('篩選器一')
    expect(sidebar.text()).toContain('篩選器二')
  })

  // 2. 兩個個人工作區名稱可分辨（不是兩邊都叫同一個「個人工作區」）
  it('2. 兩個個人工作區名稱可分辨（不是兩邊都叫同一個「個人工作區」）', async () => {
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return {
          data: [
            { id: 'alice-personal', name: 'Alice 的工作區', is_personal: true, created_by: 'u1', updated_at: 1 },
            { id: 'bob-personal', name: 'Bob 的工作區', is_personal: true, created_by: 'u2', updated_at: 1 },
          ],
        }
      }
      return { data: [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: null }] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('u1', 'alice@example.com')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))

    const router = testRouter()
    const sidebar = mountWith(AppSidebar, pinia, { router })
    const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
    await sidebar.vm.$nextTick()
    await dialog.vm.$nextTick()

    // 側邊欄與成員對話框中的選項文字
    const sidebarOptions = sidebar.find('select').findAll('option').map((o) => o.text())
    const dialogOptions = dialog.find('select').findAll('option').map((o) => o.text())

    expect(sidebarOptions).toEqual(['Alice 的工作區', 'Bob 的工作區'])
    expect(dialogOptions).toEqual(['Alice 的工作區', 'Bob 的工作區'])
    expect(sidebarOptions).not.toContain('個人工作區')

    // pickCurrentWorkspaceId 預設選中自己建立的個人工作區，而非依據第一筆 is_personal
    const picked = pickCurrentWorkspaceId(workspace.workspaces, { userId: 'u1', rememberedId: null })
    expect(picked).toBe('alice-personal')
  })

  // 3. 邀請連結：未登入先登入再自動加入；已登入直接加入並切到該區
  describe('3. 邀請連結', () => {
    it('未登入時點邀請連結，先暫存 token 並提示登入，登入後自動加入並切換工作區', async () => {
      const auth = useAuthStore()
      auth.status = 'signed-out'

      // 未登入開啟邀請頁面
      const router = testRouter()
      await router.push('/accept-invite?token=invite-token-abc')
      const view = mountWith(AcceptInviteView, pinia, { router })
      await view.vm.$nextTick()

      expect(view.text()).toContain('請先登入，登入完成後會自動加入邀請你的工作區')
      expect(localStorage.getItem('todoTask:pendingInvite')).toBe('invite-token-abc')

      // 模擬登入完成：提供 accept_invitation 與 workspaces 的 mock
      mockFetch((url) => {
        if (url.includes('/rpc/accept_invitation')) {
          return { data: 'joined-ws' }
        }
        if (url.includes('/workspaces?')) {
          return {
            data: [{ id: 'joined-ws', name: '受邀加入的工作區', is_personal: false, created_by: 'u2', updated_at: 1 }],
          }
        }
        return { data: [] }
      })

      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u1')
      auth.status = 'signed-in'

      await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('joined-ws'))
      expect(localStorage.getItem('todoTask:pendingInvite')).toBeNull()
      expect(workspace.currentWorkspaceId).toBe('joined-ws')
    })

    it('已登入時點邀請連結，直接呼叫 acceptInvite 加入並切到該區', async () => {
      mockFetch((url) => {
        if (url.includes('/rpc/accept_invitation')) {
          return { data: 'target-ws' }
        }
        if (url.includes('/workspaces?')) {
          return {
            data: [{ id: 'target-ws', name: '行銷部工作區', is_personal: false, created_by: 'u3', updated_at: 1 }],
          }
        }
        return { data: [] }
      })

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u1')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toBeDefined())

      const router = testRouter()
      await router.push('/accept-invite?token=invite-token-xyz')
      const view = mountWith(AcceptInviteView, pinia, { router })
      await vi.waitFor(() => expect(view.text()).toContain('已加入「行銷部工作區」工作區'))

      expect(workspace.currentWorkspaceId).toBe('target-ws')
    })
  })

  // 4. 邀請信有寄出（若有開寄信）／複製連結仍可用
  describe('4. 邀請信有寄出（若有開寄信）／複製連結仍可用', () => {
    it('有開寄信且寄出成功時：顯示「邀請信已寄出」且複製連結可用', async () => {
      mockFetch((url) => {
        if (url.includes('/workspaces?')) {
          return { data: [{ id: 'w1', name: '我的工作區', is_personal: true, created_by: 'u1', updated_at: 1 }] }
        }
        if (url.includes('/workspace_members?')) {
          return { data: [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }] }
        }
        if (url.includes('/rpc/create_invitation')) {
          return { data: 'token-email-sent' }
        }
        if (url.includes('/functions/v1/send-invitation-email')) {
          return { data: { sent: true } }
        }
        return { data: [] }
      })

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u1')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('w1'))

      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      })

      const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
      await dialog.find('#invite-email').setValue('user@example.com')
      await dialog.find('form').trigger('submit')
      await vi.waitFor(() => expect(dialog.text()).toContain('邀請信已寄出'))

      const linkInput = dialog.find('#invite-link')
      expect((linkInput.element as HTMLInputElement).value).toContain('token=token-email-sent')

      // 複製連結仍可用
      const copyBtn = dialog.findAll('button').find((b) => b.text().includes('複製'))
      expect(copyBtn).toBeDefined()
      await copyBtn!.trigger('click')
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('token=token-email-sent'))
      expect(dialog.text()).toContain('已複製')
    })

    it('未開寄信或寄信失敗時：顯示「邀請信沒有寄出」友善提示，複製連結仍然可用', async () => {
      mockFetch((url) => {
        if (url.includes('/workspaces?')) {
          return { data: [{ id: 'w1', name: '我的工作區', is_personal: true, created_by: 'u1', updated_at: 1 }] }
        }
        if (url.includes('/workspace_members?')) {
          return { data: [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }] }
        }
        if (url.includes('/rpc/create_invitation')) {
          return { data: 'token-no-email' }
        }
        if (url.includes('/functions/v1/send-invitation-email')) {
          return { data: { sent: false, reason: 'not_configured' } }
        }
        return { data: [] }
      })

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u1')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('w1'))

      const writeTextMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      })

      const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
      await dialog.find('#invite-email').setValue('user@example.com')
      await dialog.find('form').trigger('submit')
      await vi.waitFor(() => expect(dialog.text()).toContain('邀請信沒有寄出'))

      expect(dialog.text()).toContain('用下面這個連結，自行傳給對方一樣可以加入')
      const linkInput = dialog.find('#invite-link')
      expect((linkInput.element as HTMLInputElement).value).toContain('token=token-no-email')

      const copyBtn = dialog.findAll('button').find((b) => b.text().includes('複製'))
      await copyBtn!.trigger('click')
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('token=token-no-email'))
    })
  })

  // 5. 撤銷邀請後連結失效
  it('5. 撤銷邀請後連結失效', async () => {
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'w1', name: '我的工作區', is_personal: true, created_by: 'u1', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return { data: [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }] }
      }
      if (url.includes('/invitations?')) {
        return {
          data: [
            { id: 'inv-1', email: 'pending@example.com', role: 'member', created_at: '', expires_at: '', accepted_at: null, revoked_at: null },
          ],
        }
      }
      if (url.includes('/rpc/revoke_invitation')) {
        return { data: undefined }
      }
      if (url.includes('/rpc/accept_invitation')) {
        return { ok: false, status: 400, data: '這個邀請已經被撤銷' }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('u1')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.pendingInvitations).toHaveLength(1))

    const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
    expect(dialog.text()).toContain('pending@example.com')
    const revokeBtn = dialog.find('button[class*="text-danger-ink"]')
    await revokeBtn.trigger('click')

    await vi.waitFor(() => expect(workspace.pendingInvitations).toHaveLength(0))

    // 當已被撤銷的連結被開啟時，acceptInvite 回傳 false 並設定友善錯誤訊息
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = testRouter()
    await router.push('/accept-invite?token=revoked-token')
    const view = mountWith(AcceptInviteView, pinia, { router })
    await vi.waitFor(() => expect(view.text()).toContain('這個邀請連結無法使用，可能已經過期或被撤銷'))
  })

  // 6. 改角色：admin／member／commenter／viewer 各測一輪
  it('6. 改角色：admin／member／commenter／viewer 各測一輪，權限完全符合', async () => {
    let bobRole = 'member'
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'w1', name: '團隊', is_personal: false, created_by: 'u1', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return {
          data: [
            { user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } },
            { user_id: 'u2', role: bobRole, joined_at: '', profiles: { display_name: 'Bob', avatar_url: null } },
          ],
        }
      }
      if (url.includes('/rest/v1/workspace_members')) {
        return { data: undefined }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('u1')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.members).toHaveLength(2))

    const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
    const roleSelect = dialog.find('#role-u2')

    const rolesToTest = ['admin', 'member', 'commenter', 'viewer'] as const
    for (const role of rolesToTest) {
      bobRole = role
      await roleSelect.setValue(role)
      await vi.waitFor(() => expect(workspace.members.find((m) => m.user_id === 'u2')?.role).toBe(role))
    }

    // 驗證當前使用者處於四種角色時在 TaskDetailForm 的畫面行為
    // 1) admin
    workspace.members = [{ user_id: 'u1', role: 'admin', joined_at: '', profiles: null }]
    expect(workspace.canWriteTasks).toBe(true)
    expect(workspace.canComment).toBe(true)
    expect(workspace.canManageProjects).toBe(true)
    expect(workspace.canManageMembers).toBe(true)
    expect(workspace.taskWriteRestriction).toBeNull()

    // 2) member
    workspace.members = [{ user_id: 'u1', role: 'member', joined_at: '', profiles: null }]
    expect(workspace.canWriteTasks).toBe(true)
    expect(workspace.canComment).toBe(true)
    expect(workspace.canManageProjects).toBe(false)
    expect(workspace.canManageMembers).toBe(false)
    expect(workspace.taskWriteRestriction).toBeNull()

    // 3) commenter
    workspace.members = [{ user_id: 'u1', role: 'commenter', joined_at: '', profiles: null }]
    expect(workspace.canWriteTasks).toBe(false)
    expect(workspace.canComment).toBe(true)
    expect(workspace.taskWriteRestriction).toBe('commenter')

    const commenterForm = mountWith(TaskDetailForm, pinia, {
      props: { task: makeTask('測試任務', false, { id: 'task-1', workspaceId: 'w1' }) },
    })
    expect(commenterForm.text()).toContain('你目前是僅留言，可以留言但不能改任務')
    expect(commenterForm.find('fieldset').attributes('disabled')).toBeDefined()
    expect(commenterForm.find('button[type="submit"]').exists()).toBe(false)

    // 4) viewer
    workspace.members = [{ user_id: 'u1', role: 'viewer', joined_at: '', profiles: null }]
    expect(workspace.canWriteTasks).toBe(false)
    expect(workspace.canComment).toBe(false)
    expect(workspace.taskWriteRestriction).toBe('viewer')

    const viewerForm = mountWith(TaskDetailForm, pinia, {
      props: { task: makeTask('測試任務', false, { id: 'task-1', workspaceId: 'w1' }) },
    })
    expect(viewerForm.text()).toContain('你目前是僅檢視，只能看任務，無法編輯或留言')
    expect(viewerForm.find('fieldset').attributes('disabled')).toBeDefined()
    expect(viewerForm.find('button[type="submit"]').exists()).toBe(false)
  })

  // 7. 踢除成員：對方重整後看不到該工作區資料
  it('7. 踢除成員：UI 正常移除，且對方重整後自動退回個人工作區、看不到被踢出的工作區資料', async () => {
    // 擁有者端：踢除成員
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'shared-ws', name: '團隊', is_personal: false, created_by: 'owner-1', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return {
          data: [
            { user_id: 'owner-1', role: 'owner', joined_at: '', profiles: { display_name: 'Owner', avatar_url: null } },
            { user_id: 'bob-2', role: 'member', joined_at: '', profiles: { display_name: 'Bob', avatar_url: null } },
          ],
        }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('owner-1')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.members).toHaveLength(2))

    const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
    const removeBobBtn = dialog.find('button[aria-label="移除成員「Bob」"]')
    expect(removeBobBtn.exists()).toBe(true)
    await removeBobBtn.trigger('click')
    await vi.waitFor(() => expect(workspace.members.map((m) => m.user_id)).toEqual(['owner-1']))

    // 被踢除的成員（Bob）端：重新載入
    freshPinia()
    const bobAuth = useAuthStore()
    const bobWorkspace = useWorkspaceStore()
    const bobTasks = useTasksStore()
    bobAuth.session = fakeSession('bob-2')

    // 模擬 Bob 之前記住的工作區是 shared-ws
    localStorage.setItem('todoTask:currentWorkspace:bob-2', 'shared-ws')

    // 因為被踢除，伺服器 RLS 回傳的工作區只剩下 Bob 自己的個人工作區
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'bob-personal', name: 'Bob 的工作區', is_personal: true, created_by: 'bob-2', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return { data: [{ user_id: 'bob-2', role: 'owner', joined_at: '', profiles: null }] }
      }
      return { data: [] }
    })

    bobTasks.items = [
      makeTask('共享區任務', false, { id: 'shared-t1', workspaceId: 'shared-ws' }),
      makeTask('個人任務', false, { id: 'personal-t1', workspaceId: 'bob-personal' }),
    ]

    await bobWorkspace.load()
    // 記住的 shared-ws 已不在名單中，pickCurrentWorkspaceId 自動退回 Bob 自己的個人工作區
    expect(bobWorkspace.currentWorkspaceId).toBe('bob-personal')
    // 共享工作區的任務完全被濾除，只看得到自己個人工作區的任務
    expect(bobTasks.visibleItems.map((t) => t.id)).toEqual(['personal-t1'])
  })

  // 8. owner 不能在 UI 把自己降級／被踢（自我降級防護）
  it('8. owner 不能在 UI 把自己降級／被踢（自我降級防護）', async () => {
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'w1', name: '團隊', is_personal: false, created_by: 'owner-id', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return {
          data: [
            { user_id: 'owner-id', role: 'owner', joined_at: '', profiles: { display_name: 'Boss', avatar_url: null } },
            { user_id: 'member-id', role: 'member', joined_at: '', profiles: { display_name: 'Employee', avatar_url: null } },
          ],
        }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('owner-id')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.members).toHaveLength(2))

    const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })

    // 擁有者自己那一列：
    // 1. 不存在角色選單
    expect(dialog.find('#role-owner-id').exists()).toBe(false)
    // 2. 顯示靜態唯讀標籤「擁有者」
    expect(dialog.text()).toContain('擁有者')
    // 3. 不存在移除按鈕
    expect(dialog.find('button[aria-label="移除成員「Boss」"]').exists()).toBe(false)

    // 其他成員列才有角色選單與移除按鈕
    expect(dialog.find('#role-member-id').exists()).toBe(true)
    expect(dialog.find('button[aria-label="移除成員「Employee」"]').exists()).toBe(true)

    // 邀請表單中的角色選單也不包含 owner
    const inviteRoleOptions = dialog.find('#invite-role').findAll('option').map((o) => o.attributes('value'))
    expect(inviteRoleOptions).not.toContain('owner')
    expect(inviteRoleOptions).toEqual(['admin', 'member', 'commenter', 'viewer'])
  })

  // 9. 成員人數上限：滿員時邀請／接受會顯示「成員已滿」友好訊息
  describe('9. 成員人數上限', () => {
    it('滿員時邀請新成員：顯示友好的「成員已滿」訊息', async () => {
      mockFetch((url) => {
        if (url.includes('/workspaces?')) {
          return { data: [{ id: 'w1', name: '團隊', is_personal: false, created_by: 'u1', updated_at: 1 }] }
        }
        if (url.includes('/workspace_members?')) {
          return { data: [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }] }
        }
        if (url.includes('/rpc/create_invitation')) {
          return { ok: false, status: 400, data: { code: 'WS004', message: '這個工作區的成員已滿（上限 20 人）' } }
        }
        return { data: [] }
      })

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u1')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('w1'))

      vi.spyOn(console, 'error').mockImplementation(() => {})
      const dialog = mountWith(MembersDialog, pinia, { props: { open: true } })
      await dialog.find('#invite-email').setValue('overflow@example.com')
      await dialog.find('form').trigger('submit')
      await vi.waitFor(() => expect(dialog.text()).toContain('這個工作區的成員已經滿了，請聯絡工作區管理者'))
      expect(dialog.text()).not.toContain('WS004')
    })

    it('滿員時接受邀請：顯示友好的「成員已滿」訊息', async () => {
      mockFetch((url) => {
        if (url.includes('/rpc/accept_invitation')) {
          return { ok: false, status: 400, data: { code: 'WS004', message: '這個工作區的成員已滿（上限 20 人），請聯絡工作區管理者' } }
        }
        if (url.includes('/workspaces?')) {
          return { data: [{ id: 'w1', name: '個人', is_personal: true, created_by: 'new-user', updated_at: 1 }] }
        }
        return { data: [] }
      })

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('new-user')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('w1'))

      vi.spyOn(console, 'error').mockImplementation(() => {})
      const router = testRouter()
      await router.push('/accept-invite?token=full-cap-token')
      const view = mountWith(AcceptInviteView, pinia, { router })
      await vi.waitFor(() => expect(view.text()).toContain('這個工作區的成員已經滿了，請聯絡工作區管理者'))
      expect(view.text()).not.toContain('WS004')
    })
  })

  // 10. 接受邀請不會把自己（尤其是 owner）意外降級
  it('10. 接受邀請不會把自己（尤其是 owner）意外降級', async () => {
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: [{ id: 'w1', name: '我的專案區', is_personal: false, created_by: 'owner-1', updated_at: 1 }] }
      }
      if (url.includes('/workspace_members?')) {
        return { data: [{ user_id: 'owner-1', role: 'owner', joined_at: '', profiles: { display_name: 'Owner', avatar_url: null } }] }
      }
      if (url.includes('/rpc/accept_invitation')) {
        return { ok: false, status: 400, data: { message: '你是這個工作區的擁有者，不能透過邀請連結變更自己的身分' } }
      }
      return { data: [] }
    })

    const auth = useAuthStore()
    const workspace = useWorkspaceStore()
    auth.session = fakeSession('owner-1', 'owner@example.com')
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.members).toHaveLength(1))

    // 後端 0024 migration: owner 點了自己發給別人的 member 邀請時丟出異常拒絕
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = testRouter()
    await router.push('/accept-invite?token=accidental-self-invite')
    const view = mountWith(AcceptInviteView, pinia, { router })
    await vi.waitFor(() => expect(view.text()).toContain('這個邀請連結無法使用，可能已經過期或被撤銷'))

    // owner 依然保持 owner 身分，完全未被覆蓋或降級
    expect(workspace.myRole).toBe('owner')
    expect(workspace.members.find((m) => m.user_id === 'owner-1')?.role).toBe('owner')
  })
})
