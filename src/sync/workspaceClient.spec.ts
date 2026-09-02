import { describe, it, expect, vi, afterEach } from 'vitest'
import { SyncHttpError } from './restClient'
import {
  fetchMyWorkspaces,
  fetchWorkspaceMembers,
  fetchPendingInvitations,
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  updateMemberRole,
  removeMember,
} from './workspaceClient'

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response as Response)
}

afterEach(() => vi.restoreAllMocks())

describe('fetchMyWorkspaces', () => {
  it('組出查詢全部欄位的 GET 請求', async () => {
    const rows = [{ id: 'w1', name: '個人工作區', is_personal: true, created_by: 'u1', updated_at: 1 }]
    const fetchMock = mockFetch({ ok: true, json: async () => rows } as Response)

    const result = await fetchMyWorkspaces('token')

    expect(result).toEqual(rows)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/workspaces?select=*')
    expect(options.method).toBe('GET')
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer token')
  })

  it('HTTP 失敗時丟出 SyncHttpError', async () => {
    mockFetch({ ok: false, status: 401, text: async () => 'invalid token' } as Response)
    await expect(fetchMyWorkspaces('bad')).rejects.toThrow(SyncHttpError)
  })
})

describe('fetchWorkspaceMembers', () => {
  it('帶上 workspace_id 過濾與 profiles embedding', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => [] } as Response)
    await fetchWorkspaceMembers('w1', 'token')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('workspace_id=eq.w1')
    expect(url).toContain('profiles(display_name,avatar_url)')
  })
})

describe('fetchPendingInvitations', () => {
  it('只查還沒接受也沒撤銷的邀請', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => [] } as Response)
    await fetchPendingInvitations('w1', 'token')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('accepted_at=is.null')
    expect(url).toContain('revoked_at=is.null')
  })
})

describe('createInvitation', () => {
  it('打 create_invitation RPC，帶上工作區／信箱／角色', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => 'a-token' } as Response)

    const result = await createInvitation('w1', 'bob@example.com', 'member', 'token')

    expect(result).toBe('a-token')
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rpc/create_invitation')
    expect(JSON.parse(options.body as string)).toEqual({
      p_workspace_id: 'w1',
      p_email: 'bob@example.com',
      p_role: 'member',
    })
  })
})

describe('revokeInvitation / acceptInvitation', () => {
  it('revokeInvitation 打 revoke_invitation RPC', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => null } as Response)
    await revokeInvitation('inv-1', 'token')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rpc/revoke_invitation')
    expect(JSON.parse(options.body as string)).toEqual({ p_invitation_id: 'inv-1' })
  })

  it('acceptInvitation 打 accept_invitation RPC，回傳工作區 id', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => 'w1' } as Response)
    const result = await acceptInvitation('raw-token', 'token')

    expect(result).toBe('w1')
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toEqual({ p_token: 'raw-token' })
  })
})

describe('updateMemberRole / removeMember', () => {
  it('updateMemberRole 送出 PATCH，帶上兩個過濾條件與新角色', async () => {
    const fetchMock = mockFetch({ ok: true } as Response)
    await updateMemberRole('w1', 'u1', 'admin', 'token')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('workspace_id=eq.w1')
    expect(url).toContain('user_id=eq.u1')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body as string)).toEqual({ role: 'admin' })
  })

  it('removeMember 送出 DELETE', async () => {
    const fetchMock = mockFetch({ ok: true } as Response)
    await removeMember('w1', 'u1', 'token')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.method).toBe('DELETE')
  })

  it('失敗時丟出 SyncHttpError', async () => {
    mockFetch({ ok: false, status: 403, text: async () => 'forbidden' } as Response)
    await expect(updateMemberRole('w1', 'u1', 'admin', 'token')).rejects.toThrow(SyncHttpError)
    await expect(removeMember('w1', 'u1', 'token')).rejects.toThrow(SyncHttpError)
  })
})
