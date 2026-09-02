import { fetchRowsSince } from './restClient'
import { isTombstone } from './rowMapping'

/**
 * 一張表的拉取。推送已經不在這裡——M1 把推送整個換成 outbox＋RPC
 * （sync/rpc.ts 的 sendOp，由 stores/sync.ts 的 drainOutbox 驅動），
 * 不再是「跟本地指紋比對差異、整列 upsert」。這裡只保留拉取，
 * 是刻意留白，不是漏掉：拉取回來之後「跟現在的本地狀態合併」這一步
 * 留給呼叫端（stores/sync.ts）做，不是這個函式自己接著做——中間有一次
 * 網路等待，如果合併用的是呼叫當下就讀好的本地快照，使用者在等待期間
 * 若剛好做了「整份陣列替換」式的操作（remove／batchUpdate／undo…），
 * 合併結果蓋回去時會把那個操作靜靜蓋掉。呼叫端要在網路呼叫結束後、
 * 緊接著同步讀一次「現在」的本地狀態再合併，兩者之間沒有 await，
 * 才不會有這個時間差。
 */

export interface TableBinding<T extends { id: string; updatedAt: number }> {
  table: string
  fromRemote: (row: Record<string, unknown>) => unknown
  /** 對應 domain/task.ts 的 normalizeTask 等——邊界正規化，不在這裡另外驗證一次。 */
  normalize: (raw: unknown) => T | null
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
