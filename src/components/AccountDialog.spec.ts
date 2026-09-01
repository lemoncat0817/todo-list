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
 * 三個狀態（未登入／等待驗證碼／已登入）對應 stores/auth.ts 的 status。
 * sync/authClient.ts 整份 mock 掉——這裡測的是畫面跟 store 之間的接線，
 * 不是 GoTrueClient 本身（那是 stores/auth.spec.ts 的事）。
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
    // sync.start() 的網路層在別的地方測過；這裡只要不讓它真的打網路。
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response)
  })

  afterEach(() => vi.restoreAllMocks())

  const mountDialog = () => mountWith(AccountDialog, pinia, { props: { open: true } })
  const emailInput = (w: Wrapper) => w.find('input[type=email]')
  const codeInput = (w: Wrapper) => w.find('input[inputmode=numeric]')

  it('未登入時顯示信箱表單，且不預先載入認證模組', () => {
    const w = mountDialog()
    expect(emailInput(w).exists()).toBe(true)
    expect(authClientMock.requestOtp).not.toHaveBeenCalled()
  })

  it('送出信箱後進入等待驗證碼的狀態，顯示寄到哪個信箱', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)

    expect(authClientMock.requestOtp).toHaveBeenCalledWith('me@example.com')
    expect(w.text()).toContain('me@example.com')
    expect(codeInput(w).exists()).toBe(true)
  })

  it('寄送失敗時顯示錯誤，不進入等待驗證碼狀態', async () => {
    authClientMock.requestOtp.mockResolvedValue({ name: 'AuthApiError', message: 'boom', status: 500 } as AuthError)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)

    expect(w.find('[role=alert]').exists()).toBe(true)
    expect(codeInput(w).exists()).toBe(false)
  })

  it('驗證碼正確後顯示已登入，並啟動同步', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    authClientMock.verifyOtp.mockResolvedValue({ session: fakeSession(), error: null })
    const w = mountDialog()
    const sync = useSyncStore()
    const startSpy = vi.spyOn(sync, 'start')

    await emailInput(w).setValue('me@example.com')
    await submit(w)
    await codeInput(w).setValue('123456')
    await submit(w)

    expect(w.text()).toContain('已登入')
    expect(w.text()).toContain('me@example.com')
    expect(startSpy).toHaveBeenCalled()
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

  it('登出會先停止同步、再清掉 session', async () => {
    const auth = useAuthStore()
    const sync = useSyncStore()
    auth.session = fakeSession()
    auth.status = 'signed-in'
    authClientMock.signOut.mockResolvedValue(undefined)
    const stopSpy = vi.spyOn(sync, 'stop')

    const w = mountDialog()
    const signOutButton = w.findAll('button').find((b) => b.text() === '登出')
    await signOutButton?.trigger('click')
    await flushPromises()

    expect(stopSpy).toHaveBeenCalled()
    expect(auth.status).toBe('signed-out')
  })

  it('換一個信箱不會清掉輸入到一半的內容以外的東西，只是回到表單', async () => {
    authClientMock.requestOtp.mockResolvedValue(null)
    const w = mountDialog()

    await emailInput(w).setValue('me@example.com')
    await submit(w)
    expect(codeInput(w).exists()).toBe(true)

    const backButton = w.findAll('button').find((b) => b.text() === '換一個信箱')
    await backButton?.trigger('click')

    expect(emailInput(w).exists()).toBe(true)
  })
})
