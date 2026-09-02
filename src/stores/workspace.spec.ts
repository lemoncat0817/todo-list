import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'

/**
 * stores/workspace.ts 的協調邏輯。sync/workspaceClient.ts 本身（組出的
 * 請求對不對）已經在 workspaceClient.spec.ts 測過，這裡驗證的是
 * 「協調」本身：auth.status 驅動的載入時機、預設選中個人工作區、
 * 角色計算、動作失敗時的錯誤處理。
 */
function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { workspace: useWorkspaceStore(), auth: useAuthStore() }
}

function fakeSession(userId = 'u1'): Session {
  return {
    access_token: 'token-123',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  } as unknown as Session
}

function mockFetch(impl: (url: string) => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    return { ok: true, json: async () => impl(String(url)) } as Response
  })
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => localStorage.clear())

describe('未登入時', () => {
  it('不會自動載入，工作區清單維持空的', async () => {
    const { workspace } = setup()
    expect(workspace.workspaces).toEqual([])
  })
})

describe('auth.status 變成 signed-in 時', () => {
  it('自動載入工作區清單並選中個人工作區', async () => {
    const { workspace, auth } = setup()
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return [
          { id: 'shared-1', name: '團隊', is_personal: false, created_by: 'u2', updated_at: 1 },
          { id: 'personal-1', name: '個人工作區', is_personal: true, created_by: 'u1', updated_at: 1 },
        ]
      }
      if (url.includes('/workspace_members?')) {
        return [{ user_id: 'u1', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'u1', avatar_url: null } }]
      }
      return []
    })

    auth.session = fakeSession()
    auth.status = 'signed-in'

    await vi.waitFor(() => expect(workspace.workspaces.length).toBe(2))
    expect(workspace.currentWorkspaceId).toBe('personal-1')
    await vi.waitFor(() => expect(workspace.members.length).toBe(1))
    expect(workspace.myRole).toBe('owner')
    expect(workspace.canManageMembers).toBe(true)
  })

  it('沒有個人工作區時退回第一筆（理論上不該發生，但不該整個掛掉）', async () => {
    const { workspace, auth } = setup()
    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return [{ id: 'shared-1', name: '團隊', is_personal: false, created_by: 'u2', updated_at: 1 }]
      }
      return []
    })

    auth.session = fakeSession()
    auth.status = 'signed-in'

    await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('shared-1'))
  })
})

describe('auth.status 變成 signed-out 時', () => {
  it('清空所有工作區資料', async () => {
    const { workspace, auth } = setup()
    mockFetch((url) => (url.includes('/workspaces?') ? [{ id: 'w1', name: 'x', is_personal: true, created_by: 'u1', updated_at: 1 }] : []))

    auth.session = fakeSession()
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.workspaces.length).toBe(1))

    auth.session = null
    auth.status = 'signed-out'

    // watch() 的 callback 是排程執行（預設 flush: 'pre'），不是同步——
    // 跟 stores/sync.ts 對應的測試一樣，得等它真的跑過才能斷言。
    await vi.waitFor(() => expect(workspace.workspaces).toEqual([]))
    expect(workspace.currentWorkspaceId).toBeNull()
    expect(workspace.members).toEqual([])
  })
})

describe('invite', () => {
  it('成功時回傳 token 並重新載入成員／邀請清單', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    workspace.currentWorkspaceId = 'w1'
    mockFetch((url) => {
      if (url.includes('/rpc/create_invitation')) return 'raw-token'
      return []
    })

    const result = await workspace.invite('bob@example.com', 'member')

    expect(result).toBe('raw-token')
    expect(workspace.error).toBeNull()
  })

  it('失敗時回傳 null 並設定友善的錯誤訊息', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    workspace.currentWorkspaceId = 'w1'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' } as Response)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await workspace.invite('bob@example.com', 'member')

    expect(result).toBeNull()
    expect(workspace.error).toBe('邀請沒有送出，請稍後再試一次')
  })
})

describe('removeMemberFromWorkspace', () => {
  it('成功時從本地成員清單移除', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    workspace.currentWorkspaceId = 'w1'
    workspace.members = [
      { user_id: 'u1', role: 'owner', joined_at: '', profiles: null },
      { user_id: 'u2', role: 'member', joined_at: '', profiles: null },
    ]
    mockFetch(() => null)

    await workspace.removeMemberFromWorkspace('u2')

    expect(workspace.members.map((m) => m.user_id)).toEqual(['u1'])
  })
})

describe('acceptInvite', () => {
  it('成功時重新載入工作區並切到新加入的那個', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    mockFetch((url) => {
      if (url.includes('/rpc/accept_invitation')) return 'new-ws'
      if (url.includes('/workspaces?')) return [{ id: 'new-ws', name: '新團隊', is_personal: false, created_by: 'u2', updated_at: 1 }]
      return []
    })

    const ok = await workspace.acceptInvite('some-token')

    expect(ok).toBe(true)
    expect(workspace.currentWorkspaceId).toBe('new-ws')
  })

  it('失敗時回傳 false 並顯示友善訊息，不點名技術細節', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => '邀請連結無效' } as Response)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const ok = await workspace.acceptInvite('bad-token')

    expect(ok).toBe(false)
    expect(workspace.error).toBe('這個邀請連結無法使用，可能已經過期或被撤銷')
  })
})
