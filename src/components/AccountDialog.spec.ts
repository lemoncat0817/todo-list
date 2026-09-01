import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { Pinia } from 'pinia'
import type { AuthError, Session } from '@supabase/auth-js'
import AccountDialog from '@/components/AccountDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { freshPinia, mountWith, type Wrapper } from '@/test/helpers'

/**
 * 表單送出一律用 `find('form').trigger('submit')` 而不是點送出按鈕——
 * happy-dom 不會在點擊 `<button type="submit">` 時自動幫表單派送原生的
 * submit 事件（那是瀏覽器的表單關聯行為，happy-dom 沒有完整實作）。
 * 送出後一律 `await flushPromises()`：`@submit.prevent="submitEmail"`
 * 呼叫的是一個 async 函式，Vue 不會等它完成，trigger() 的 await 只保證
 * 目前這一輪的同步更新已經 flush，不包含 handler 內部後續的 await。
 */
async function submit(w: Wrapper): Promise<void> {
  await w.find('form').trigger('submit')
  await flushPromises()
}

/**
 * 三個狀態（未登入／等待點連結／已登入）對應 stores/auth.ts 的 status。
 * sync/authClient.ts 整份 mock 掉——這裡測的是畫面跟 store 之間的接線，
 * 不是 GoTrueClient 本身（那是 stores/auth.spec.ts 的事）。
 *
 * 「等待」狀態不再有六碼驗證碼輸入框：Supabase 免費方案的內建信件服務
 * 不給改範本，寄出的一律是連結，不是碼（實測發現，見 stores/auth.ts 的
 * ensureAuthClient 註解）。畫面改成「去信箱點連結」，登入完成一律靠
 * auth.status 被動變成 signed-in 反映出來——可能是這個分頁自己（同分頁
 * 點連結），也可能是跨分頁廣播（另一個分頁點連結）。
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

function fakeSession(email = 'me@example.com'): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1', email },
  } as unknown as Session
}

describe('AccountDialog.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    vi.clearAllMocks()
    authClientMock.onAuthStateChange.mockReturnValue(() => {})
    // stores/sync.ts 現在會自己 watch auth.status 決定要不要 start()——
    // 這裡只要不讓它真的打網路，不需要另外 spy/停用。
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)
  })

  /**
   * auth.status 一旦被測試改成 signed-in（不管是直接賦值模擬跨分頁廣播，
   * 還是掛載時就已經是 signed-in），stores/sync.ts 自己的 watcher 就會
   * 呼叫 start()——一個有好幾段 await（讀 IndexedDB 的 fingerprint、
   * 打網路）的非同步函式。測試本身的斷言不需要等它跑完，但如果放著不管，
   * 這個承諾會在測試檔案結束、happy-dom 的 window 已經被回收之後才繼續跑到
   * `window.addEventListener`，變成一個跨到下一個檔案才炸開的
   * unhandled rejection（ReferenceError: window is not defined）。
   * 跟 stores/sync.spec.ts 的 activeSync 清理是同一個道理：等它真的跑完
   * （lastPulledAt 有值是唯一可靠的「整輪結束」訊號）才 stop()。
   */
  afterEach(async () => {
    const sync = useSyncStore()
    if (sync.enabled) {
      await vi.waitFor(() => expect(sync.lastPulledAt).not.toBeNull(), { timeout: 2000 })
    }
    sync.stop()
    vi.restoreAllMocks()
  })

  const mountDialog = () => mountWith(AccountDialog, pinia, { props: { open: true } })
  const emailInput = (w: Wrapper) => w.find('input[type=email]')

  it('未登入時顯示信箱表單，且不預先載入認證模組', () => {
    const w = mountDialog()
    expect(emailInput(w).exists()).toBe(true)
    expect(authClientMock.requestOtp).not.toHaveBeenCalled()
  })

  it('OAUTH_PROVIDERS_ENABLED 為 false 時，Google／GitHub 按鈕不顯示——底層邏輯已經做完並保留，只是先不開放給使用者', () => {
    const w = mountDialog()
    expect(w.text()).not.toContain('以 Google 繼續')
    expect(w.text()).not.toContain('以 GitHub 繼續')
    // 這個常數目前應該是 false；點擊觸發的行為（provider 對不對、錯誤顯示）
    // 在 stores/auth.spec.ts 的 signInWithOAuthProvider 測過，不在這裡重複，
    // 因為這裡已經沒有按鈕可以點了
    expect(authClientMock.signInWithOAuth).not.toHaveBeenCalled()
  })

  it('送出信箱後顯示「去信箱點連結」，不是六碼驗證碼輸入框', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)

    expect(authClientMock.requestOtp).toHaveBeenCalledWith('me@example.com')
    expect(w.text()).toContain('me@example.com')
    expect(w.text()).toContain('去信箱點裡面的連結')
    expect(w.find('input[inputmode=numeric]').exists(), '不該再有驗證碼輸入框').toBe(false)
  })

  it('寄送失敗時顯示錯誤，不進入等待狀態', async () => {
    authClientMock.requestOtp.mockResolvedValue({ name: 'AuthApiError', message: 'boom', status: 500 } as AuthError)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)

    expect(w.find('[role=alert]').exists()).toBe(true)
    expect(w.text()).not.toContain('去信箱點裡面的連結')
  })

  it('登入在別的分頁（或同分頁點連結）完成時，畫面被動反映成已登入，並自動開始同步', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const w = mountDialog()
    const sync = useSyncStore()

    await emailInput(w).setValue('me@example.com')
    await submit(w)
    expect(w.text()).toContain('去信箱點裡面的連結')
    expect(sync.enabled).toBe(false)

    // 模擬跨分頁廣播：這個分頁自己完全沒有「送出驗證碼」以外的動作，
    // 登入狀態單純從外部變成 signed-in（stores/auth.ts 的 ensureAuthClient
    // 訂閱到的 onAuthStateChange 就是這樣運作的）
    const auth = useAuthStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    await flushPromises()

    expect(w.text()).toContain('已登入')
    expect(w.text()).toContain('me@example.com')
    // start() 不是這個元件呼叫的，是 stores/sync.ts 自己 watch auth.status 觸發——
    // 用 sync.enabled（狀態）而不是 spy 那個函式來驗證：watcher 呼叫的是
    // setup() 內的原始閉包，不是 store 物件上可以被 spyOn 攔截的那個屬性。
    expect(sync.enabled).toBe(true)
  })

  it('已登入時同步失敗會顯示錯誤訊息', async () => {
    const auth = useAuthStore()
    const sync = useSyncStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    sync.syncError = '網路連不上'

    const w = mountDialog()

    expect(w.text()).toContain('上次同步失敗')
    expect(w.text()).toContain('網路連不上')
  })

  it('登出後 session 清空，同步引擎也跟著自動停止', async () => {
    const auth = useAuthStore()
    const sync = useSyncStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    authClientMock.signOut.mockResolvedValue(undefined)

    const w = mountDialog()
    await flushPromises()
    expect(sync.enabled, '掛載時 auth 已經是 signed-in，同步應該已經自動啟動').toBe(true)

    const signOutButton = w.findAll('button').find((b) => b.text() === '登出')
    await signOutButton?.trigger('click')
    await flushPromises()

    expect(auth.status).toBe('signed-out')
    // stop() 不是元件呼叫的，是 stores/sync.ts watch 到 auth.status 變化才觸發
    expect(sync.enabled, '同步應該跟著自動停止').toBe(false)
  })

  it('換一個信箱回到信箱表單', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)
    expect(w.text()).toContain('去信箱點裡面的連結')

    const backButton = w.findAll('button').find((b) => b.text() === '換一個信箱')
    await backButton?.trigger('click')

    expect(emailInput(w).exists()).toBe(true)
  })
})
