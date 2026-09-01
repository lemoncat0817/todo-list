/**
 * 雙向同步的合併規則。
 *
 * `db/backup.ts` 的 `mergeById`（匯入語意：後到者一律贏）不能直接拿來用——
 * 那是「使用者明確選了一個檔案要併進來」，這裡是「背景定期跟遠端對一次」，
 * 語意不同：本地剛做的修改不該被幾秒前的遠端舊資料蓋掉。
 *
 * 用的是逐列 Last-Write-Wins，比較每一列的 `updatedAt`：
 * - 兩邊都有：比較新的留下
 * - 只有遠端有：新增進本地
 * - 只有本地有、且遠端明確標示已刪除：從本地移除
 *
 * 代價是誠實的：兩台裝置在同一列的不同欄位「幾乎同時」各自修改，
 * 較舊的那次會整列被覆蓋，不是逐欄位合併。對單人多裝置情境（同一個人
 * 幾乎不可能真的同時在兩台裝置改同一筆）這個代價可接受。
 */

interface HasIdAndUpdatedAt {
  id: string
  updatedAt: number
}

export interface MergeResult<T> {
  /** 合併後的完整清單，供直接指派回 store 的 items.value。 */
  merged: T[]
  /**
   * 這次合併裡，遠端版本贏過本地（或本地本來就沒有）的那幾列。
   * 呼叫端（stores/sync.ts）要用這份清單去更新推送用的指紋——
   * 這些列現在本地跟遠端已經一致，不該在下一次推送時被當成「本地有新改動」
   * 又送一次，那樣會產生一次沒有意義的網路請求，也可能把 updatedAt 相同
   * 但不是同一筆的寫入誤判成沒問題（雖然目前不會，但語意上就不乾淨）。
   */
  remoteWon: T[]
  /** 遠端回報已刪除、這次真的從本地移除的 id——指紋要記得把它們刪掉。 */
  removedIds: string[]
}

/**
 * @param local 目前本地的清單
 * @param remote 這次從遠端拉回來的列（只包含遠端有變動的，不需要是全部）
 * @param remoteDeletedIds 遠端這次回報「已刪除」的 id 集合
 */
export function mergeByUpdatedAt<T extends HasIdAndUpdatedAt>(
  local: readonly T[],
  remote: readonly T[],
  remoteDeletedIds: readonly string[] = [],
): MergeResult<T> {
  const byId = new Map(local.map((item) => [item.id, item]))
  const deleted = new Set(remoteDeletedIds)
  const remoteWon: T[] = []
  const removedIds: string[] = []

  for (const id of deleted) {
    if (byId.delete(id)) removedIds.push(id)
  }

  for (const item of remote) {
    // 遠端這筆同時又出現在刪除清單裡是矛盾狀態（理論上不該發生），
    // 刪除視為更明確的意圖，優先處理
    if (deleted.has(item.id)) continue
    const existing = byId.get(item.id)
    if (existing === undefined || item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item)
      remoteWon.push(item)
    }
  }

  return { merged: [...byId.values()], remoteWon, removedIds }
}
