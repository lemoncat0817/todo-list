import { GoTrueClient, type AuthError, type Provider, type Session, type SupportedStorage } from '@supabase/auth-js'
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
 * 實測這個模組（含 @supabase/auth-js）動態載入後是獨立一塊 23.16 kB gzip，
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
    // OAuth（Google／GitHub）一定要走重導向：使用者離開頁面、供應商登入完
    // 再導回來。flowType 明確設成 pkce（預設是 implicit）是關鍵——implicit
    // 流程把 session 塞在 URL 的 # 片段（access_token=...），换完 session 後
    // 會直接清空 window.location.hash，跟這個工具的 hash 路由（#/today）
    // 正面衝突。PKCE 流程改用 ?code= 這個查詢參數，Vue Router 的 hash 模式
    // 從來不讀 location.search，兩者天生不會互相干擾（已經對照
    // @supabase/auth-js 原始碼確認：PKCE 換完 session 只會刪掉 code／
    // sb_flow_id 這兩個查詢參數，不會動 hash）。
    flowType: 'pkce',
    // 開著讓 GoTrueClient 自己偵測、交換 URL 上的 OAuth code——
    // stores/auth.ts 的 restore() 負責在對的時機（有 code 或先前登入過）
    // 才觸發這個模組的載入，這裡只管「載入之後怎麼處理」。
    detectSessionInUrl: true,
  })
  return client
}

export type { Session, AuthError, Provider }

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

/**
 * 觸發 OAuth 登入。這個函式回傳時使用者通常已經在被導去供應商的路上了
 * （GoTrueClient 內部直接呼叫 window.location.assign()）——回傳的 error
 * 只涵蓋「重導向網址組不出來」這種極少數的前置失敗，供應商那端的拒絕
 * 不會反映在這裡，而是回程時反映在 URL 的 error 參數，由 restore() 那條路徑處理。
 */
export async function signInWithOAuth(provider: Provider): Promise<AuthError | null> {
  const options: { redirectTo: string; queryParams?: Record<string, string> } = {
    redirectTo: `${window.location.origin}${window.location.pathname}`,
  }
  if (provider === 'google') {
    options.queryParams = { prompt: 'select_account' }
  }
  const { error } = await getAuthClient().signInWithOAuth({
    provider,
    options,
  })
  return error
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
