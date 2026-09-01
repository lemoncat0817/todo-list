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
