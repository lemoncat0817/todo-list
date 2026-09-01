import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AuthError, Provider, Session } from '@supabase/auth-js'
import { isSyncConfigured } from '@/sync/config'

export type AuthStatus = 'signed-out' | 'sending' | 'verifying' | 'signed-in'

/**
 * 帳號狀態。
 *
 * 刻意不在模組頂層 import `sync/authClient`——那個檔案含 @supabase/auth-js，
 * 實測動態載入後是 23.16 kB gzip。這個 store 本身很輕，可以放心讓 App.vue
 * 一直掛著；只有 requestMagicLink／verifyCode／signOut／restore 這些動作
 * 真的被呼叫時，才 `await import()` 那個模組。沒有帳號的使用者不會付這個成本。
 */
export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('signed-out')
  const session = ref<Session | null>(null)
  const email = ref('')
  /** 上一次操作的錯誤訊息，畫面用來顯示提示；不影響任何本地功能。 */
  const error = ref<string | null>(null)

  function applySession(next: Session | null): void {
    session.value = next
    status.value = next ? 'signed-in' : 'signed-out'
  }

  /**
   * 認證模組只載入一次、onAuthStateChange 只訂閱一次，不管是哪個動作
   * 先觸發載入——這裡曾經是一個真實的 bug：Supabase 預設的信件範本寄的是
   * 連結（magic link）不是六碼驗證碼，使用者常常是在另一個分頁點連結
   * 完成登入（GoTrueClient 用 BroadcastChannel 把這個結果廣播給同一個
   * storageKey 的所有分頁），但原本只在 verifyCode() 成功「之後」才訂閱
   * onAuthStateChange，還在「請貼驗證碼」畫面等待的那個分頁根本沒在聽，
   * 廣播等於白發，畫面永遠卡住。現在只要載入過模組就一定訂閱好，
   * 不管登入最後是在哪個分頁、用哪種方式完成的。
   */
  let authModulePromise: Promise<typeof import('@/sync/authClient')> | null = null
  function ensureAuthClient(): Promise<typeof import('@/sync/authClient')> {
    authModulePromise ??= import('@/sync/authClient').then((auth) => {
      auth.onAuthStateChange((next) => applySession(next))
      return auth
    })
    return authModulePromise
  }

  /**
   * 開機時嘗試還原 session，也是 OAuth（Google／GitHub）重導向回來後
   * 真正完成登入的地方。
   *
   * 只有三種情況才值得付動態載入的成本——大多數人都不是，這個檢查
   * 讓他們完全不觸發 import()：
   * 1. 先前真的登入過（`todoTask:auth` 這把 localStorage key 存在）
   * 2. 網址上有供應商／magic link 導回來的 `?code=`（sync/authClient.ts 的
   *    detectSessionInUrl 會在載入時自動把它換成 session）
   * 3. 網址上有供應商回報的錯誤（使用者在同意畫面按了取消，或設定有誤）——
   *    這裡不觸發完整登入流程，只是要把錯誤訊息撈出來給使用者看，
   *    不然畫面會安靜地退回未登入、看起來像什麼都沒發生
   *
   * 呼叫端（main.ts）在背景呼叫，不擋首次繪製。
   */
  async function restore(): Promise<void> {
    if (!isSyncConfigured) return

    const params = new URLSearchParams(location.search)
    const oauthErrorDescription = params.get('error_description') ?? params.get('error')
    if (oauthErrorDescription) {
      error.value = oauthErrorDescription
      // 清掉網址上的錯誤參數，否則重新整理會一直卡著同一個舊錯誤
      const url = new URL(location.href)
      for (const key of ['error', 'error_description', 'error_code']) url.searchParams.delete(key)
      window.history.replaceState(window.history.state, '', url.toString())
    }

    const hasOAuthCallback = params.has('code')
    let hasStoredSession = false
    try {
      hasStoredSession = localStorage.getItem('todoTask:auth') !== null
    } catch {
      // 存取被擋時視為沒有——跟 infra/persist.ts 的降級方式一致
    }
    if (!hasStoredSession && !hasOAuthCallback) return

    const auth = await ensureAuthClient()
    applySession(await auth.getSession())
  }

  /**
   * 觸發 OAuth 登入。函式回傳時瀏覽器通常已經在離開這個頁面的路上——
   * 這裡不需要、也沒辦法更新登入狀態，那是回程時 restore() 的事。
   * 回傳的錯誤只涵蓋極少數的前置失敗（例如設定不完整）。
   */
  async function signInWithOAuthProvider(provider: Provider): Promise<void> {
    error.value = null
    const auth = await ensureAuthClient()
    const authError = await auth.signInWithOAuth(provider)
    if (authError) error.value = describeError(authError)
  }

  async function requestMagicLink(value: string): Promise<boolean> {
    error.value = null
    status.value = 'sending'
    const auth = await ensureAuthClient()
    const authError = await auth.requestOtp(value)
    if (authError) {
      error.value = describeError(authError)
      status.value = 'signed-out'
      return false
    }
    email.value = value
    status.value = 'verifying'
    return true
  }

  async function verifyCode(code: string): Promise<boolean> {
    error.value = null
    const auth = await ensureAuthClient()
    const { session: next, error: authError } = await auth.verifyOtp(email.value, code)
    if (authError || !next) {
      error.value = describeError(authError)
      return false
    }
    applySession(next)
    return true
  }

  /** 回到輸入信箱那一步，不清掉已經在進行中的 session。 */
  function cancelVerification(): void {
    if (status.value === 'verifying') status.value = 'signed-out'
    error.value = null
  }

  /**
   * 登出只斷開同步、清掉 session，不刪除本地 IndexedDB 資料——
   * 離線優先的原則，使用者要清空本地資料是另一個明確動作（見 DataDialog 的匯入／匯出），
   * 這裡不做。
   */
  async function signOut(): Promise<void> {
    const auth = await ensureAuthClient()
    await auth.signOut()
    applySession(null)
    email.value = ''
  }

  return {
    status,
    session,
    email,
    error,
    restore,
    requestMagicLink,
    verifyCode,
    cancelVerification,
    signInWithOAuthProvider,
    signOut,
  }
})

/** AuthError 的訊息通常是英文技術字串；只挑常見情境轉成中文，其餘原樣顯示總比空白好。 */
function describeError(authError: AuthError | null): string {
  if (!authError) return '驗證碼不正確或已過期，請重新申請'
  if (authError.message.toLowerCase().includes('rate limit')) {
    return '請求太頻繁，請稍等一分鐘再試'
  }
  return authError.message
}
