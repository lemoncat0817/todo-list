import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useWorkspaceStore, storePendingInviteToken } from '@/stores/workspace'
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

/**
 * `.text` 一定要跟 `.json` 回傳同樣的內容——sync/workspaceClient.ts 的
 * rpc()／sync/restClient.ts 的 callRpc() 現在改讀 res.text() 再自己
 * JSON.parse（見那邊的 parseJsonResponse() 說明：revoke_invitation()
 * 這種 returns void 的 RPC，PostgREST 回的是空內文，不是 null，只假
 * `.json()` 掩蓋不了這件事，也不能只假前者不假後者，不然換成呼叫端
 * 讀 `.text()` 的路徑就會在測試裡直接因為缺這個方法而炸開）。
 */
function mockFetch(impl: (url: string) => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const result = impl(String(url))
    return { ok: true, json: async () => result, text: async () => JSON.stringify(result) ?? '' } as Response
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

  it('也清空線上狀態——上一個帳號的線上名單不該留給下一個登入的人看', async () => {
    const { workspace, auth } = setup()
    mockFetch((url) => (url.includes('/workspaces?') ? [{ id: 'w1', name: 'x', is_personal: true, created_by: 'u1', updated_at: 1 }] : []))

    auth.session = fakeSession()
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(workspace.workspaces.length).toBe(1))
    workspace.setOnlineUsers('w1', ['u1', 'u2'])
    expect(workspace.onlineUserIds).toEqual(new Set(['u1', 'u2']))

    auth.session = null
    auth.status = 'signed-out'

    await vi.waitFor(() => expect(workspace.workspaces).toEqual([]))
    expect(workspace.onlineUserIds).toEqual(new Set())
  })
})

describe('線上狀態（presence）', () => {
  it('setOnlineUsers 只影響對應的工作區，onlineUserIds 只反映目前所在工作區', () => {
    const { workspace } = setup()
    workspace.workspaces = [
      { id: 'w1', name: 'A', is_personal: true, created_by: 'u1', updated_at: 1 },
      { id: 'w2', name: 'B', is_personal: false, created_by: 'u1', updated_at: 1 },
    ]
    workspace.currentWorkspaceId = 'w1'

    workspace.setOnlineUsers('w1', ['u1'])
    workspace.setOnlineUsers('w2', ['u1', 'u2', 'u3'])

    expect(workspace.onlineUserIds).toEqual(new Set(['u1']))

    workspace.currentWorkspaceId = 'w2'
    expect(workspace.onlineUserIds).toEqual(new Set(['u1', 'u2', 'u3']))
  })

  it('沒有目前所在工作區時 onlineUserIds 是空集合', () => {
    const { workspace } = setup()
    expect(workspace.onlineUserIds).toEqual(new Set())
  })
})

describe('invite', () => {
  it('成功時回傳連結並重新載入成員／邀請清單；信有寄出時 emailSent 為 true', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    workspace.currentWorkspaceId = 'w1'
    mockFetch((url) => {
      if (url.includes('/rpc/create_invitation')) return 'raw-token'
      if (url.includes('/functions/v1/send-invitation-email')) return { sent: true }
      return []
    })

    const result = await workspace.invite('bob@example.com', 'member')

    expect(result?.link).toContain('raw-token')
    expect(result?.emailSent).toBe(true)
    expect(workspace.error).toBeNull()
  })

  it('寄信服務沒設定（回報 sent:false）時，連結仍然正常回傳', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    workspace.currentWorkspaceId = 'w1'
    mockFetch((url) => {
      if (url.includes('/rpc/create_invitation')) return 'raw-token'
      if (url.includes('/functions/v1/send-invitation-email')) return { sent: false, reason: 'not_configured' }
      return []
    })

    const result = await workspace.invite('bob@example.com', 'member')

    expect(result?.link).toContain('raw-token')
    expect(result?.emailSent).toBe(false)
    expect(workspace.error).toBeNull()
  })

  it('寄信這一步本身出錯時不影響邀請本身——連結照樣回傳，只是 emailSent 是 false', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    workspace.currentWorkspaceId = 'w1'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/rpc/create_invitation')) {
        return { ok: true, json: async () => 'raw-token', text: async () => '"raw-token"' } as Response
      }
      if (String(url).includes('/functions/v1/send-invitation-email')) {
        return { ok: false, status: 500, text: async () => 'boom' } as Response
      }
      return { ok: true, json: async () => [], text: async () => '[]' } as Response
    })

    const result = await workspace.invite('bob@example.com', 'member')

    expect(result?.link).toContain('raw-token')
    expect(result?.emailSent).toBe(false)
    expect(workspace.error).toBeNull()
  })

  it('建立邀請本身失敗時回傳 null 並設定友善的錯誤訊息', async () => {
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

describe('pending invite token（邀請連結點開時還沒登入的情境）', () => {
  it('登入完成時自動消費 localStorage 裡待處理的邀請 token，並清掉它', async () => {
    storePendingInviteToken('stored-token')
    const { workspace, auth } = setup()
    const fetchMock = mockFetch((url) => {
      if (url.includes('/rpc/accept_invitation')) return 'joined-ws'
      if (url.includes('/workspaces?')) return [{ id: 'joined-ws', name: '團隊', is_personal: false, created_by: 'u2', updated_at: 1 }]
      return []
    })

    auth.session = fakeSession()
    auth.status = 'signed-in'

    await vi.waitFor(() => expect(workspace.currentWorkspaceId).toBe('joined-ws'))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rpc/accept_invitation'))).toBe(true)
    expect(localStorage.getItem('todoTask:pendingInvite')).toBeNull()
  })

  it('沒有待處理 token 時登入照常，不會多打 accept_invitation', async () => {
    const { workspace, auth } = setup()
    const fetchMock = mockFetch((url) => (url.includes('/workspaces?') ? [{ id: 'w1', name: 'x', is_personal: true, created_by: 'u1', updated_at: 1 }] : []))

    auth.session = fakeSession()
    auth.status = 'signed-in'

    await vi.waitFor(() => expect(workspace.workspaces.length).toBe(1))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rpc/accept_invitation'))).toBe(false)
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

  /**
   * 釘住 AcceptInviteView.vue 自己的 watcher 跟 auth.status 的 watcher
   * 幾乎同時各呼叫一次 acceptInvite（同一個 token）時可能發生的問題：
   * accept_invitation 不是能重送去重的 RPC，同一個 token 打兩次，第二次
   * 會撞到「已經被使用過」而回報失敗，即使第一次其實成功了。
   */
  it('同一個 token 幾乎同時呼叫兩次，只會真的打一次 RPC', async () => {
    const { workspace, auth } = setup()
    auth.session = fakeSession()
    const fetchMock = mockFetch((url) => {
      if (url.includes('/rpc/accept_invitation')) return 'joined-ws'
      if (url.includes('/workspaces?')) return [{ id: 'joined-ws', name: '團隊', is_personal: false, created_by: 'u2', updated_at: 1 }]
      return []
    })

    const [first, second] = await Promise.all([workspace.acceptInvite('same-token'), workspace.acceptInvite('same-token')])

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/rpc/accept_invitation'))).toHaveLength(1)
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
