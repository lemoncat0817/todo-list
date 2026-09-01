import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AuthError, Session } from '@supabase/auth-js'
import { isSyncConfigured } from '@/sync/config'

export type AuthStatus = 'signed-out' | 'sending' | 'verifying' | 'signed-in'

/**
 * 帳號狀態。
 *
 * 刻意不在模組頂層 import `sync/authClient`——那個檔案含 @supabase/auth-js，
 * 實測動態載入後是 23.07 kB gzip。這個 store 本身很輕，可以放心讓 App.vue
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
   * 開機時嘗試還原 session。
   *
   * 只有先前真的登入過（`todoTask:auth` 這把 localStorage key 存在）才值得
   * 付這次動態載入的成本——大多數使用者從沒登入過，這個檢查讓他們完全
   * 不觸發 import()。呼叫端（main.ts）在背景呼叫，不擋首次繪製。
   */
  async function restore(): Promise<void> {
    if (!isSyncConfigured) return
    let hasStoredSession = false
    try {
      hasStoredSession = localStorage.getItem('todoTask:auth') !== null
    } catch {
      // 存取被擋時視為沒有——跟 infra/persist.ts 的降級方式一致
    }
    if (!hasStoredSession) return

    const auth = await import('@/sync/authClient')
    applySession(await auth.getSession())
    auth.onAuthStateChange((next) => applySession(next))
  }

  async function requestMagicLink(value: string): Promise<boolean> {
    error.value = null
    status.value = 'sending'
    const auth = await import('@/sync/authClient')
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
    const auth = await import('@/sync/authClient')
    const { session: next, error: authError } = await auth.verifyOtp(email.value, code)
    if (authError || !next) {
      error.value = describeError(authError)
      return false
    }
    applySession(next)
    // 訂閱後續的 token 刷新／登出事件，換裝置或分頁時狀態才會一起更新
    auth.onAuthStateChange((s) => applySession(s))
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
    const auth = await import('@/sync/authClient')
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
