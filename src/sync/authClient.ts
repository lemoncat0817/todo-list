import { GoTrueClient, type AuthError, type Session, type SupportedStorage } from '@supabase/auth-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * 認證客戶端。
 *
 * 只包 `@supabase/auth-js`（GoTrue 的官方 client），不裝完整的
 * `@supabase/supabase-js`——那個套件的 postgrest／realtime／storage／functions
 * 我們一支都用不到，資料讀寫在 sync/restClient.ts 手寫。認證則反過來：
 * token 刷新、過期、儲存這些安全相關的細節，官方套件比自己重寫可靠，
 * 體積也遠低於完整 SDK。
 *
 * 實測這個模組（含 @supabase/auth-js）動態載入後是獨立一塊 23.07 kB gzip，
 * 不算小，所以這個模組本身沒有任何頂層副作用，只有呼叫 getAuthClient() 時
 * 才會建立實例——stores/auth.ts 只在使用者真的要登入時才 `import()` 這個檔案，
 * 沒有帳號的使用者完全不會下載、也不會付這個 bundle 的成本。
 */

let client: GoTrueClient | null = null

/** localStorage 不可用時（無痕模式、Cookie 停用）退回記憶體，登入狀態撐不過重新整理，但不會直接壞掉。 */
function resolveStorage(): SupportedStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__todoTask_auth_probe__'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return localStorage
    }
  } catch {
    // Safari 停用 Cookie、或無痕模式的部分實作，存取 localStorage 會直接拋錯
  }
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  }
}

function getAuthClient(): GoTrueClient {
  if (client) return client
  client = new GoTrueClient({
    url: `${SUPABASE_URL}/auth/v1`,
    headers: { apikey: SUPABASE_ANON_KEY },
    // 跟現有 localStorage key 的命名慣例一致（todoTask:prefs / todoTask:theme）
    storageKey: 'todoTask:auth',
    storage: resolveStorage(),
    autoRefreshToken: true,
    persistSession: true,
    // 這個工具沒有專門接收 magic link 的頁面路由，靠 hash 路由自己解析 URL 的
    // access_token／refresh_token 片段太容易跟現有的 hash 導覽互相干擾，
    // 改用 OTP 六碼驗證碼：使用者收信、把碼貼回頁面，不需要處理回呼網址。
    detectSessionInUrl: false,
  })
  return client
}

export type { Session, AuthError }

export async function requestOtp(email: string): Promise<AuthError | null> {
  const { error } = await getAuthClient().signInWithOtp({ email })
  return error
}

export async function verifyOtp(
  email: string,
  token: string,
): Promise<{ session: Session | null; error: AuthError | null }> {
  const { data, error } = await getAuthClient().verifyOtp({ email, token, type: 'email' })
  return { session: data.session, error }
}

export async function signOut(): Promise<void> {
  await getAuthClient().signOut()
}

export async function getSession(): Promise<Session | null> {
  const { data } = await getAuthClient().getSession()
  return data.session
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = getAuthClient().onAuthStateChange((_event, session) => callback(session))
  return () => subscription.unsubscribe()
}
