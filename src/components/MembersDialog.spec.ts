import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import MembersDialog from '@/components/MembersDialog.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import { freshPinia, mountWith } from '@/test/helpers'

/**
 * 直接寫入 stores/workspace.ts 的狀態，不透過 auth.status 觸發真正的
 * load() 流程——那條路徑（含網路請求）在 workspace.spec.ts 已經測過，
 * 這裡要測的是「畫面跟 store 狀態之間的接線」。
 */
function fakeSession(userId = 'u1'): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  } as unknown as Session
}

describe('MembersDialog.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
  })

  const mountDialog = () => mountWith(MembersDialog, pinia, { props: { open: true } })

  it('owner 看得到角色下拉選單、移除按鈕、邀請表單', () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [
      { user_id: 'u1', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
      { user_id: 'u2', role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]

    const w = mountDialog()

    expect(w.text()).toContain('Alice')
    expect(w.text()).toContain('（你）')
    expect(w.text()).toContain('Bob')
    // 自己那一列不能改角色／移除，Bob 那一列才有；另一個 select 是
    // 邀請表單本身的角色選單，跟成員列表無關，兩個一起算才是 2。
    expect(w.findAll('select').length).toBe(2)
    expect(w.find('#role-u2').exists()).toBe(true)
    expect(w.find('#role-u1').exists()).toBe(false)
    expect(w.find('form').exists()).toBe(true)
  })

  it('一般成員（非 admin/owner）看不到角色下拉、移除按鈕、邀請表單，只看到唯讀角色標籤', () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u2')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [
      { user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } },
      { user_id: 'u2', role: 'member', joined_at: '', profiles: { display_name: 'Bob', avatar_url: null } },
    ]

    const w = mountDialog()

    expect(w.findAll('select').length).toBe(0)
    expect(w.find('form').exists()).toBe(false)
    expect(w.text()).toContain('擁有者')
  })

  it('建立邀請成功後顯示可複製的連結', async () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }]
    vi.spyOn(workspace, 'invite').mockResolvedValue('raw-token-abc')

    const w = mountDialog()
    await w.find('#invite-email').setValue('bob@example.com')
    await w.find('form').trigger('submit')
    await w.vm.$nextTick()

    const link = w.find('#invite-link')
    expect(link.exists()).toBe(true)
    expect((link.element as HTMLInputElement).value).toContain('raw-token-abc')
    expect((link.element as HTMLInputElement).value).toContain('#/accept-invite?token=')
  })

  it('只有一個工作區時不顯示切換器', () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.workspaces = [{ id: 'w1', name: '個人工作區', is_personal: true, created_by: 'u1', updated_at: 1 }]

    const w = mountDialog()

    expect(w.find('select').exists()).toBe(false)
  })

  it('有多個工作區時顯示切換器，選擇後呼叫 selectWorkspace', async () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.workspaces = [
      { id: 'w1', name: '個人工作區', is_personal: true, created_by: 'u1', updated_at: 1 },
      { id: 'w2', name: '設計團隊', is_personal: false, created_by: 'u2', updated_at: 1 },
    ]
    const selectSpy = vi.spyOn(workspace, 'selectWorkspace').mockResolvedValue()

    const w = mountDialog()
    const select = w.find('select')
    expect(select.exists()).toBe(true)
    await select.setValue('w2')

    expect(selectSpy).toHaveBeenCalledWith('w2')
  })

  it('待處理邀請顯示信箱與撤銷按鈕', () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [{ user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } }]
    workspace.pendingInvitations = [
      { id: 'inv-1', email: 'carol@example.com', role: 'member', created_at: '', expires_at: '', accepted_at: null, revoked_at: null },
    ]

    const w = mountDialog()

    expect(w.text()).toContain('carol@example.com')
    expect(w.text()).toContain('撤銷')
  })

  it('線上狀態：自己一定算在線上，其餘成員依 workspace.onlineUserIds 顯示', () => {
    const auth = useAuthStore()
    auth.session = fakeSession('u1')
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [
      { user_id: 'u1', role: 'owner', joined_at: '', profiles: { display_name: 'Alice', avatar_url: null } },
      { user_id: 'u2', role: 'member', joined_at: '', profiles: { display_name: 'Bob', avatar_url: null } },
      { user_id: 'u3', role: 'member', joined_at: '', profiles: { display_name: 'Carol', avatar_url: null } },
    ]
    workspace.setOnlineUsers('w1', ['u2'])

    const w = mountDialog()
    const rows = w.findAll('li')
    const dotClass = (li: (typeof rows)[number]) => li.find('[aria-hidden="true"]').classes()

    expect(dotClass(rows[0]!)).toContain('bg-success') // Alice：自己
    expect(dotClass(rows[1]!)).toContain('bg-success') // Bob：在 onlineUserIds 裡
    expect(dotClass(rows[2]!)).toContain('bg-sunken') // Carol：不在
  })
})
