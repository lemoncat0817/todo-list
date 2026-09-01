import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { AuthError, Session } from '@supabase/auth-js'

/**
 * sync/authClient.ts 是動態載入的（含 @supabase/auth-js，實測 23.07 kB gzip），
 * 這裡整份 mock 掉——這個 spec 測的是 stores/auth.ts 的狀態機，不是
 * GoTrueClient 本身。isSyncConfigured 也一併 mock 成 true：預設的測試環境
 * 沒有設定 VITE_SUPABASE_URL，是「未設定」分支，那個分支只有一行
 * `if (!isSyncConfigured) return`，不需要為它另開一個檔案。
 */
vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))

const authClientMock = {
  requestOtp: vi.fn<(email: string) => Promise<AuthError | null>>(),
  verifyOtp: vi.fn<(email: string, code: string) => Promise<{ session: Session | null; error: AuthError | null }>>(),
  signOut: vi.fn<() => Promise<void>>(),
  getSession: vi.fn<() => Promise<Session | null>>(),
  onAuthStateChange: vi.fn<(cb: (s: Session | null) => void) => () => void>(() => () => {}),
}
vi.mock('@/sync/authClient', () => authClientMock)

// vi.mock 的工廠必須在檔案頂層宣告，所以 useAuthStore 要動態 import 進來，
// 確保它讀到的是上面 mock 過的模組，而不是真正的 sync/authClient。
const { useAuthStore } = await import('@/stores/auth')

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useAuthStore()
}

function fakeSession(email = 'me@example.com'): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1', email },
  } as unknown as Session
}

function fakeAuthError(message: string): AuthError {
  return { name: 'AuthApiError', message, status: 400 } as AuthError
}

beforeEach(() => {
  vi.clearAllMocks()
  authClientMock.onAuthStateChange.mockReturnValue(() => {})
})

describe('requestMagicLink', () => {
  it('成功時進入 verifying 狀態並記住信箱', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const auth = setup()

    const ok = await auth.requestMagicLink('me@example.com')

    expect(ok).toBe(true)
    expect(auth.status).toBe('verifying')
    expect(auth.email).toBe('me@example.com')
  })

  it('失敗時回到 signed-out 並記錄錯誤訊息', async () => {
    authClientMock.requestOtp.mockResolvedValue(fakeAuthError('rate limit exceeded'))
    const auth = setup()

    const ok = await auth.requestMagicLink('me@example.com')

    expect(ok).toBe(false)
    expect(auth.status).toBe('signed-out')
    expect(auth.error).toContain('太頻繁')
  })
})

describe('verifyCode', () => {
  it('成功時套用 session 並訂閱後續狀態變化', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    authClientMock.verifyOtp.mockResolvedValue({ session: fakeSession(), error: null })
    const auth = setup()
    await auth.requestMagicLink('me@example.com')

    const ok = await auth.verifyCode('123456')

    expect(ok).toBe(true)
    expect(auth.status).toBe('signed-in')
    expect(auth.session?.user.email).toBe('me@example.com')
    expect(authClientMock.onAuthStateChange).toHaveBeenCalled()
  })

  it('驗證碼錯誤時不改變登入狀態，並顯示錯誤', async () => {
    authClientMock.verifyOtp.mockResolvedValue({ session: null, error: fakeAuthError('invalid token') })
    const auth = setup()

    const ok = await auth.verifyCode('000000')

    expect(ok).toBe(false)
    expect(auth.status).not.toBe('signed-in')
    expect(auth.error).toContain('invalid token')
  })
})

describe('cancelVerification', () => {
  it('從 verifying 回到 signed-out，不影響已經存在的 session', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const auth = setup()
    await auth.requestMagicLink('me@example.com')

    auth.cancelVerification()

    expect(auth.status).toBe('signed-out')
  })
})

describe('signOut', () => {
  it('清掉 session 與信箱，但不動任何本地任務資料（這裡只管帳號狀態）', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    authClientMock.verifyOtp.mockResolvedValue({ session: fakeSession(), error: null })
    authClientMock.signOut.mockResolvedValue(undefined)
    const auth = setup()
    await auth.requestMagicLink('me@example.com')
    await auth.verifyCode('123456')

    await auth.signOut()

    expect(auth.status).toBe('signed-out')
    expect(auth.session).toBeNull()
    expect(auth.email).toBe('')
  })
})

describe('restore', () => {
  it('沒有登入過（沒有 todoTask:auth 這把 key）時不觸發任何動態載入', async () => {
    localStorage.clear()
    const auth = setup()

    await auth.restore()

    expect(authClientMock.getSession).not.toHaveBeenCalled()
    expect(auth.status).toBe('signed-out')
  })

  it('先前登入過時還原 session', async () => {
    localStorage.setItem('todoTask:auth', '{"anything":"opaque-to-this-store"}')
    authClientMock.getSession.mockResolvedValue(fakeSession())
    const auth = setup()

    await auth.restore()

    expect(auth.status).toBe('signed-in')
    expect(authClientMock.onAuthStateChange).toHaveBeenCalled()
  })
})
