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
  signInWithOAuth: vi.fn<(provider: string) => Promise<AuthError | null>>(),
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
  window.history.pushState({}, '', '/')
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

describe('signInWithOAuthProvider', () => {
  it('成功時不改變 status——瀏覽器已經在離開頁面的路上，狀態更新是回程 restore() 的事', async () => {
    authClientMock.signInWithOAuth.mockResolvedValue(null)
    const auth = setup()

    await auth.signInWithOAuthProvider('google')

    expect(authClientMock.signInWithOAuth).toHaveBeenCalledWith('google')
    expect(auth.status).toBe('signed-out')
    expect(auth.error).toBeNull()
  })

  it('前置失敗（例如設定不完整）時顯示錯誤', async () => {
    authClientMock.signInWithOAuth.mockResolvedValue(fakeAuthError('provider not enabled'))
    const auth = setup()

    await auth.signInWithOAuthProvider('github')

    expect(auth.error).toContain('provider not enabled')
  })
})

describe('restore', () => {
  it('沒有登入過、網址也乾淨時不觸發任何動態載入', async () => {
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

  it('網址上有 OAuth 供應商導回來的 code 時，即使先前沒登入過也會觸發還原', async () => {
    localStorage.clear()
    window.history.pushState({}, '', '/?code=fake-pkce-code')
    authClientMock.getSession.mockResolvedValue(fakeSession())
    const auth = setup()

    await auth.restore()

    // sync/authClient.ts 的 detectSessionInUrl 負責真正把 code 換成 session，
    // 這裡只驗證 restore() 有沒有正確判斷「這個時機值得載入認證模組」
    expect(authClientMock.getSession).toHaveBeenCalled()
    expect(auth.status).toBe('signed-in')
  })

  it('網址上有供應商回報的錯誤時，顯示錯誤並清掉網址上的參數，不觸發完整登入流程', async () => {
    localStorage.clear()
    window.history.pushState({}, '', '/?error=access_denied&error_description=User+cancelled')
    const auth = setup()

    await auth.restore()

    expect(auth.error).toBe('User cancelled')
    expect(authClientMock.getSession, '單純的錯誤不需要載入認證模組').not.toHaveBeenCalled()
    expect(location.search).toBe('')
  })
})
