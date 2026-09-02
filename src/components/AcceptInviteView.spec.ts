import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import AcceptInviteView from '@/components/AcceptInviteView.vue'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

function fakeSession(): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1' },
  } as unknown as Session
}

async function mountAt(pinia: Pinia, path: string) {
  const router = testRouter()
  await router.push(path)
  return mountWith(AcceptInviteView, pinia, { router })
}

describe('AcceptInviteView.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('網址沒有 token 時顯示連結不完整的提示', async () => {
    const w = await mountAt(pinia, '/accept-invite')
    expect(w.text()).toContain('缺少邀請代碼')
  })

  it('有 token 但還沒登入時，把 token 存進 localStorage 並提示先登入', async () => {
    const w = await mountAt(pinia, '/accept-invite?token=abc123')
    expect(w.text()).toContain('請先登入')
    expect(localStorage.getItem('todoTask:pendingInvite')).toBe('abc123')
  })

  it('已登入時自動呼叫 acceptInvite，成功後顯示已加入的工作區名稱', async () => {
    const auth = useAuthStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    const workspace = useWorkspaceStore()
    vi.spyOn(workspace, 'acceptInvite').mockImplementation(async () => {
      workspace.currentWorkspaceId = 'w1'
      workspace.workspaces = [{ id: 'w1', name: '設計團隊', is_personal: false, created_by: 'u2', updated_at: 1 }]
      return true
    })

    const w = await mountAt(pinia, '/accept-invite?token=abc123')
    await vi.waitFor(() => expect(w.text()).toContain('已加入'))
    expect(w.text()).toContain('設計團隊')
  })

  it('接受失敗時顯示錯誤訊息', async () => {
    const auth = useAuthStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    const workspace = useWorkspaceStore()
    vi.spyOn(workspace, 'acceptInvite').mockImplementation(async () => {
      workspace.error = '這個邀請連結無法使用，可能已經過期或被撤銷'
      return false
    })

    const w = await mountAt(pinia, '/accept-invite?token=bad')
    await vi.waitFor(() => expect(w.text()).toContain('無法使用'))
  })
})
