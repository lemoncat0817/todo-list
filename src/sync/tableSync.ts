import { diffAgainstFingerprint } from '@/domain/diff'
import { fetchRowsSince, upsertRows } from './restClient'
import { isTombstone, makeTombstone } from './rowMapping'

/**
 * 一張表同步的兩個獨立步驟：推送、拉取。刻意不合成一支「同步一張表」的
 * 函式再由它自己去合併寫回本地——中間有一次網路等待（拉取），如果合併
 * 用的是呼叫當下就讀好的本地快照，使用者在這段等待期間如果剛好做了
 * 一個「整份陣列替換」式的操作（remove／batchUpdate／undo…），合併結果
 * 蓋回去時會把那個操作整個蓋掉，而使用者完全不會發現。
 *
 * 所以「跟現在的本地狀態合併」這一步留給呼叫端（stores/sync.ts）在
 * 兩次網路呼叫都結束後、緊接著同步讀一次「現在」的本地狀態再做，
 * 兩者之間沒有 await，就不會有這個時間差。
 */

export interface TableBinding<T extends { id: string; updatedAt: number }> {
  table: string
  toRemote: (row: T) => Record<string, unknown>
  fromRemote: (row: Record<string, unknown>) => unknown
  /** 對應 domain/task.ts 的 normalizeTask 等——邊界正規化，不在這裡另外驗證一次。 */
  normalize: (raw: unknown) => T | null
}

/**
 * 推送：把本地跟指紋的差異送出去。回傳這次算出的新指紋——
 * 呼叫端要在拉取合併完成後，把拉取贏的列也疊上去才是最終版本，
 * 這裡回傳的只是「推送這一步完成之後」的中繼狀態。
 */
export async function pushTable<T extends { id: string; updatedAt: number }>(
  binding: TableBinding<T>,
  local: readonly T[],
  fingerprint: Map<string, string>,
  accessToken: string,
): Promise<Map<string, string>> {
  const diff = diffAgainstFingerprint(local, fingerprint)
  const payload = [...diff.upserts.map(binding.toRemote), ...diff.deletes.map(makeTombstone)]
  if (payload.length > 0) await upsertRows(binding.table, payload, accessToken)
  return diff.nextFingerprint
}

export interface PullResult<T> {
  /** 拉回來、通過 normalize 的活列。 */
  live: T[]
  /** 拉回來、標記為墓碑的 id。 */
  deletedIds: string[]
}

/** 拉取：只負責把遠端資料拿回來並正規化，不碰本地狀態、不合併。 */
export async function pullTable<T extends { id: string; updatedAt: number }>(
  binding: TableBinding<T>,
  lastPulledAt: number,
  accessToken: string,
): Promise<PullResult<T>> {
  const rawRows = await fetchRowsSince(binding.table, lastPulledAt, accessToken)
  const live: T[] = []
  const deletedIds: string[] = []
  for (const raw of rawRows) {
    if (isTombstone(raw)) {
      if (typeof raw.id === 'string') deletedIds.push(raw.id)
      continue
    }
    const normalized = binding.normalize(binding.fromRemote(raw))
    if (normalized) live.push(normalized)
  }
  return { live, deletedIds }
}
