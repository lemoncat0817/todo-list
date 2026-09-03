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

/**
 * PostgREST／PostgreSQL 錯誤回應是 JSON（`{code, details, hint, message}`），
 * `code` 是 SQLSTATE——資料庫那邊用 `raise exception ... using errcode = 'PT001'`
 * 之類的自訂代碼區分「權限不足」「已被刪除」「成員已滿」這幾種失敗類型時
 * （見 supabase/migrations/0020_task_patch_errors.sql、
 * 0021_workspace_member_cap.sql），前端要能讀到這個代碼才能對應到不同的
 * 使用者說法，不能只看 HTTP 狀態碼（多半都是同一個 400）。
 *
 * `detail` 已經被 safeText() 截到 300 字元，理論上有極端狀況會截斷 JSON
 * 導致 parse 失敗——這裡的錯誤訊息都很短（一兩句中文），實務上不會碰到；
 * parse 失敗就當作沒有代碼，不影響既有的「顯示通用說法」行為。
 */
function parsePostgrestErrorCode(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

/**
 * PostgreSQL 23505 + 主鍵約束（`*_pkey`）。create_* RPC 在目標列已存在時
 * 會撞這個——見 supabase/migrations/0028_create_idempotent_on_pk.sql。
 * 其他 unique 約束（例如 `projects_one_inbox_per_workspace`）名字不含
 * `_pkey`，不能當成「建立成功」吞掉。
 */
export function isPrimaryKeyConflict(detail: string): boolean {
  return parsePostgrestErrorCode(detail) === '23505' && /_pkey/.test(detail)
}

export class SyncHttpError extends Error {
  /** PostgREST 錯誤回應裡的 SQLSTATE，parse 不出來就是 null（例如非 JSON 的錯誤內文）。 */
  readonly code: string | null

  constructor(
    readonly table: string,
    readonly operation: 'fetch' | 'upsert' | 'delete' | 'rpc',
    readonly status: number,
    detail: string,
  ) {
    super(`[sync] ${operation} ${table} 失敗（HTTP ${status}）：${detail}`)
    this.name = 'SyncHttpError'
    this.code = parsePostgrestErrorCode(detail)
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

/**
 * `res.json()` 對完全空的回應內文（0 bytes）會直接丟出
 * `SyntaxError: Unexpected end of JSON input`，不是回傳 `null`——這是真的
 * 在瀏覽器裡撞到才發現的，不是憑文件猜的：`revoke_invitation()`
 * （見 supabase/migrations/0008_invitations.sql）宣告 `returns void`，
 * PostgREST 對 void 回傳型別的 RPC 是回 HTTP 204 加零位元組的內文，不是
 * `null`／`{}`。呼叫端（sync/workspaceClient.ts 的 rpc()）原本無條件
 * `await res.json()`，對這支 RPC 每次都會炸開。單元測試沒抓到是因為
 * mock 直接把 `.json` 換成 `async () => null`，繞過了真正的 JSON 解析
 * 這一步，模擬不出空內文的真實行為。
 *
 * 改成先讀 text，空字串就回傳 undefined，非空才真的 parse——PostgREST
 * 對 void 以外的回傳型別（text／uuid／boolean…）一律是有內容的 JSON，
 * 不受影響。
 */
export async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  return (text === '' ? undefined : JSON.parse(text)) as T
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
  return parseJsonResponse<T>(res)
}
