import { enqueueOp } from '@/db'
import type { Op, OpKind } from '@/db/schema'
import { diffAgainstFingerprint, diffFields } from '@/domain/diff'
import { monotonicNow } from '@/domain/task'

/**
 * 表名 → 對應的 outbox 刪除 kind。pull 合併時要把「本地已經排了刪除、
 * 但還沒送到伺服器（或這一輪 drain 之後才排進去）」的 id 當成墓碑，
 * 否則遠端還活著的列會被 mergeByUpdatedAt 當成「遠端獨有」加回來。
 */
const DELETE_KIND_BY_TABLE: Record<string, OpKind> = {
  tasks: 'task.delete',
  projects: 'project.delete',
  tags: 'tag.delete',
  filters: 'filter.delete',
  comments: 'comment.delete',
  sections: 'section.delete',
}

export function pendingDeleteIdsForTable(ops: readonly Op[], table: string): readonly string[] {
  const kind = DELETE_KIND_BY_TABLE[table]
  if (!kind) return []
  return ops.filter((op) => op.kind === kind).map((op) => op.targetId)
}

/**
 * 跟 stores/tasks.ts 的 enqueueSyncOps 同一套邏輯，套用在 projects/tags/
 * filters/comments/sections 上——形狀不同但規則相同，寫一支泛型函式而不是各寫
 * 一份。`kind` 決定 op 的種類前綴，`toRemote` 是各自的欄位對應
 * （sync/rowMapping.ts）。原本內嵌在 stores/collections.ts 裡，
 * stores/comments.ts 加入後才抽成獨立檔案給兩邊共用。
 *
 * 這裡只算「要排哪些 op」，不動本地寫入——本地寫入維持整份覆寫，量小到
 * 不值得為此另外做逐列指紋；`previousIndex` 純粹是為了推導遠端補丁而
 * 存在的另一份帳，跟本地 IndexedDB 寫不寫得有效率無關。
 */
export async function enqueueCollectionOps<T extends { id: string; updatedAt: number }>(
  kind: 'project' | 'tag' | 'filter' | 'comment' | 'section',
  current: readonly T[],
  previousIndex: ReadonlyMap<string, string>,
  toRemote: (row: T) => Record<string, unknown>,
  excludeIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const { upserts, deletes, nextFingerprint } = diffAgainstFingerprint(current, previousIndex)
  // 單調時鐘，理由跟 stores/tasks.ts 的 enqueueSyncOps 一致：避免同一
  // 毫秒內排出的兩筆 op 因為 createdAt 相同，讓 outbox 的排序落在
  // 隨機的 id tie-break 上。
  const now = monotonicNow()
  const ops: Op[] = []

  for (const row of upserts) {
    if (excludeIds.has(row.id)) continue
    const previousJson = previousIndex.get(row.id)
    const before = previousJson ? toRemote(JSON.parse(previousJson) as T) : null
    const patch = diffFields(before, toRemote(row))
    if (Object.keys(patch).length === 0) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: `${kind}.${before === null ? 'create' : 'patch'}` as OpKind,
      targetId: row.id,
      payload: patch,
      createdAt: now,
      attempts: 0,
    })
  }

  for (const id of deletes) {
    if (excludeIds.has(id)) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: `${kind}.delete` as OpKind,
      targetId: id,
      payload: { deleted_at: now },
      createdAt: now,
      attempts: 0,
    })
  }

  for (const op of ops) await enqueueOp(op)
  return nextFingerprint
}
