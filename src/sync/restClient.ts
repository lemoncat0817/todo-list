import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * 手寫的 PostgREST client。
 *
 * 不裝 `@supabase/postgrest-js`：那個套件的通用查詢建構器是為了「任意查詢」
 * 設計的，而我們永遠只跑三種固定形狀的查詢（依 updated_at 拉取、批次
 * upsert、批次刪除），四張表共用同一套。用 `fetch` 直接組 URL 與 body，
 * 省下的不只是 bundle（postgrest-js 本身不重，但拉進的型別系統與建構器
 * 對這裡的需求是殺雞用牛刀），也讓「這支 client 到底送出什麼請求」
 * 一眼就看得完，不必查文件猜 `.select().eq()` 鏈最後組出的 URL長什麼樣。
 *
 * 每一支操作都接受 `accessToken`（呼叫端從 stores/auth.ts 的 session 取），
 * 不在這裡管理 token 生命週期——過期／刷新是 sync/authClient.ts（真正的
 * @supabase/auth-js）的責任，這裡只管「帶著一個有效的 token 打一次 API」。
 */

export class SyncHttpError extends Error {
  constructor(
    readonly table: string,
    readonly operation: 'fetch' | 'upsert' | 'delete' | 'rpc',
    readonly status: number,
    detail: string,
  ) {
    super(`[sync] ${operation} ${table} 失敗（HTTP ${status}）：${detail}`)
    this.name = 'SyncHttpError'
  }
}

/** sync/rpc.ts 也要組一樣的 header／錯誤內文擷取，這裡匯出而不是重複一份。 */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return '(無法讀取錯誤內容)'
  }
}

export function headers(accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

/**
 * 拉取某張表裡 `updated_at > updatedAfter` 的列（含軟刪除的墓碑，
 * 過不過濾由呼叫端決定——這裡只負責把資料拿回來）。
 */
export async function fetchRowsSince(
  table: string,
  updatedAfter: number,
  accessToken: string,
): Promise<Record<string, unknown>[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&updated_at=gt.${updatedAfter}`
  const res = await fetch(url, { method: 'GET', headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(table, 'fetch', res.status, await safeText(res))
  return (await res.json()) as Record<string, unknown>[]
}

/**
 * 批次 upsert。預設用 `on_conflict=id` + `Prefer: resolution=merge-duplicates`
 * ——已存在的列走 UPDATE（只更新這次帶的欄位，`user_id` 沒帶到就不會被
 * 動到），不存在的列走 INSERT（`user_id` 用資料表的 `default auth.uid()`）。
 *
 * `conflictColumn` 可覆寫：多數表的主鍵是 `id`，但 device_cursors（M6）
 * 的主鍵是 `device_id`——與其為了這一張表另開一支函式，加一個參數
 * 就夠，其餘呼叫端不用改。
 */
export async function upsertRows(
  table: string,
  rows: readonly Record<string, unknown>[],
  accessToken: string,
  conflictColumn = 'id',
): Promise<void> {
  if (rows.length === 0) return
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumn}`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(accessToken, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new SyncHttpError(table, 'upsert', res.status, await safeText(res))
}

/**
 * 呼叫一支不屬於 outbox 派送表（sync/rpc.ts）的一次性 RPC——那支表是
 * 專門給「op kind → 固定函式」這種對照關係用的，`workspace_storage_used`
 * 這類單純的唯讀查詢硬塞進去反而要多繞一層 Op 物件，不如直接呼叫。
 */
export async function callRpc<T>(fn: string, params: Record<string, unknown>, accessToken: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new SyncHttpError(fn, 'rpc', res.status, await safeText(res))
  return (await res.json()) as T
}
