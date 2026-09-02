/**
 * 依內容指紋算出「這批列裡真的變了什麼」。
 *
 * 從 stores/tasks.ts 的本地寫入路徑抽出來，因為 stores/sync.ts 的遠端推送
 * 需要同一套演算法、但對著另一份獨立的指紋表跑——本地表記的是「IndexedDB
 * 裡有什麼」，遠端表記的是「伺服器上有什麼」，兩者的生命週期不同
 * （本地表每次開機從 IndexedDB 重建；遠端表需要跨重新整理存活，否則離線時
 * 刪除的任務永遠推不出一個墓碑）。指紋比對整份序列化內容而不是只看
 * `updatedAt`：復原會把「比較舊」的物件放回去，只看時間戳會漏掉那種變更。
 */
export interface DiffResult<T> {
  upserts: T[]
  deletes: string[]
  nextFingerprint: Map<string, string>
}

export function diffAgainstFingerprint<T extends { id: string }>(
  rows: readonly T[],
  fingerprint: ReadonlyMap<string, string>,
): DiffResult<T> {
  const nextFingerprint = new Map<string, string>()
  const upserts: T[] = []
  for (const row of rows) {
    const signature = JSON.stringify(row)
    nextFingerprint.set(row.id, signature)
    if (fingerprint.get(row.id) !== signature) upserts.push(row)
  }
  const deletes = [...fingerprint.keys()].filter((id) => !nextFingerprint.has(id))
  return { upserts, deletes, nextFingerprint }
}

/**
 * 比較同一列的新舊兩個版本，只回傳真的變了的欄位（新版本的值）。
 *
 * 這是 outbox 欄位補丁的推導來源：`diffAgainstFingerprint` 已經知道
 * 「這一列變了」，但推去伺服器的補丁不能是整列——那正是這次同步引擎
 * 重寫要解決的問題（兩人各改一個欄位會互蓋）。`before` 是 null 代表
 * 這一列以前沒有指紋、是全新的列，這時整包 `after` 都算數。
 *
 * 泛型而不是專門對 StoredTask：呼叫端傳「遠端形狀」的物件進來
 * （toRemoteTask 之類轉換過的結果），這裡不需要知道本地／遠端的欄位
 * 對應規則，只單純逐欄位比較 JSON 字串是否相同——用字串比較而不是
 * `!==`是因為 tagIds／recurrence 這類巢狀欄位不能用參照相等判斷。
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
): Partial<T> {
  if (before === null) return after
  const patch: Partial<T> = {}
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
  }
  return patch
}
