import {
  DEFAULT_TASK_FIELDS,
  type Op,
  type OpKind,
  type Priority,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from '@/db/schema'
import { isValidISODate, isValidTime } from './dates'
import { isRecurrence } from './recurrence'
import { compareRankValues } from './rank'

/**
 * 任務形狀的正規化與驗證。
 *
 * 每一個從外部進來的物件（IndexedDB、舊版 localStorage、匯入檔）
 * 都必須先過這裡。稽核 P2 的教訓：沒有邊界驗證，一筆壞資料就能讓畫面整區消失。
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPriority(v: unknown): v is Priority {
  return v === 0 || v === 1 || v === 2 || v === 3
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function nullableISODate(v: unknown): string | null {
  return isValidISODate(v) ? v : null
}

function nullableTime(v: unknown): string | null {
  return isValidTime(v) ? v : null
}

function nullableId(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function finiteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 把任意輸入正規化成合法的 StoredTask。
 * 無法構成有效任務（缺 id 或 taskName）時回傳 null，由呼叫端濾除。
 * 其餘欄位一律補上安全的預設值，而不是讓壞值流進 store。
 *
 * fallbackRank 給讀不到合法 rank 的壞資料用（理論上不該發生，是最後
 * 一道防線，不是真的排序演算法）——呼叫端傳位置索引轉成的字串即可，
 * 不需要真的呼叫 domain/rank.ts 的 between()。
 */
export function normalizeTask(raw: unknown, fallbackRank = ''): StoredTask | null {
  if (!isRecord(raw)) return null

  const id = nullableId(raw.id) ?? (typeof raw.id === 'number' ? String(raw.id) : null)
  const taskName = typeof raw.taskName === 'string' && raw.taskName.length > 0 ? raw.taskName : null
  if (id === null || taskName === null) return null

  const now = Date.now()
  const dueDate = nullableISODate(raw.dueDate)

  return {
    id,
    taskName,
    isCompleted: raw.isCompleted === true,
    rank: str(raw.rank, fallbackRank),
    notes: str(raw.notes, DEFAULT_TASK_FIELDS.notes),
    priority: isPriority(raw.priority) ? raw.priority : DEFAULT_TASK_FIELDS.priority,
    dueDate,
    // 沒有日期的時間沒有意義，一併丟棄
    dueTime: dueDate === null ? null : nullableTime(raw.dueTime),
    projectId: nullableId(raw.projectId),
    tagIds: Array.isArray(raw.tagIds)
      ? [...new Set(raw.tagIds.filter((t): t is string => typeof t === 'string' && t.length > 0))]
      : [],
    parentId: nullableId(raw.parentId),
    recurrence: isRecurrence(raw.recurrence) ? raw.recurrence : null,
    completedAt: raw.isCompleted === true ? finiteNumber(raw.completedAt, now) : null,
    createdAt: finiteNumber(raw.createdAt, now),
    updatedAt: finiteNumber(raw.updatedAt, now),
  }
}

export function createTask(taskName: string, rank: string, overrides: Partial<StoredTask> = {}): StoredTask {
  const now = Date.now()
  return {
    ...DEFAULT_TASK_FIELDS,
    // 稽核 P17：randomUUID，不再用 Date.now() 當 id（同毫秒會碰撞）
    id: crypto.randomUUID(),
    taskName,
    isCompleted: false,
    rank,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function normalizeProject(raw: unknown, fallbackRank = ''): StoredProject | null {
  if (!isRecord(raw)) return null
  const id = nullableId(raw.id)
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null
  if (id === null || name === null) return null
  return {
    id,
    name,
    color: str(raw.color, '#1d4ed8'),
    rank: str(raw.rank, fallbackRank),
    // v4 之前的資料沒有這個欄位，補上現在的時間——比讓它是 0 更安全：
    // 0 會讓一筆舊資料在跟任何遠端版本比較時永遠「看起來最舊」而被覆蓋。
    updatedAt: finiteNumber(raw.updatedAt, Date.now()),
  }
}

export function normalizeTag(raw: unknown): StoredTag | null {
  if (!isRecord(raw)) return null
  const id = nullableId(raw.id)
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null
  if (id === null || name === null) return null
  return {
    id,
    name,
    color: str(raw.color, '#15803d'),
    updatedAt: finiteNumber(raw.updatedAt, Date.now()),
  }
}

export function normalizeFilter(raw: unknown, fallbackRank = ''): StoredFilter | null {
  if (!isRecord(raw)) return null
  const id = nullableId(raw.id)
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null
  const query = typeof raw.query === 'string' && raw.query.length > 0 ? raw.query : null
  // 沒有查詢字串的篩選器點進去只會是一片空白，直接視為無效
  if (id === null || name === null || query === null) return null
  return {
    id,
    name,
    query,
    color: str(raw.color, '#7c3aed'),
    rank: str(raw.rank, fallbackRank),
    updatedAt: finiteNumber(raw.updatedAt, Date.now()),
  }
}

const OP_KINDS: readonly OpKind[] = [
  'task.create',
  'task.patch',
  'task.delete',
  'project.create',
  'project.patch',
  'project.delete',
  'tag.create',
  'tag.patch',
  'tag.delete',
  'filter.create',
  'filter.patch',
  'filter.delete',
]

function isOpKind(v: unknown): v is OpKind {
  return typeof v === 'string' && (OP_KINDS as readonly string[]).includes(v)
}

let lastOpTimestamp = 0

/**
 * outbox 上傳器依 op 的 createdAt 排序送出，同一列的兩筆補丁一旦排錯
 * 順序，較舊的那筆反而在伺服器上蓋過較新的。`Date.now()` 只有毫秒
 * 精度，同一毫秒內排進兩個 op（例如程式化的批次操作，或使用者手速夠快
 * 連續做兩個動作）時，兩者的 createdAt 會完全相同——IndexedDB 對相同
 * 索引值的 tie-break 落在主鍵（op 自己的 uuid），跟真正的時間順序毫無
 * 關係，等於排序結果隨機。這裡確保同一個分頁的呼叫序列裡 createdAt
 * 嚴格遞增，不管系統時間解析度多粗。
 *
 * 只需要在單一分頁的執行期間單調遞增——跨重新整理／裝置的排序本來就
 * 是靠伺服器的 updated_at 判斷，不依賴這個值。
 */
export function monotonicNow(): number {
  const now = Date.now()
  lastOpTimestamp = now > lastOpTimestamp ? now : lastOpTimestamp + 1
  return lastOpTimestamp
}

/** 佇列裡的操作是這個版本的 app 自己寫進去的，仍然正規化——
 * 未來欄位演進時，舊版本留下的列不該讓上傳器整批掛掉。 */
export function normalizeOp(raw: unknown): Op | null {
  if (!isRecord(raw)) return null
  const id = nullableId(raw.id)
  const targetId = nullableId(raw.targetId)
  if (id === null || targetId === null || !isOpKind(raw.kind)) return null
  return {
    id,
    kind: raw.kind,
    targetId,
    payload: isRecord(raw.payload) ? raw.payload : {},
    createdAt: finiteNumber(raw.createdAt, Date.now()),
    attempts: finiteNumber(raw.attempts, 0),
  }
}

/**
 * 子任務展平成單層 Map，方便查詢某任務的子項。
 * 只支援一層子任務 —— 無限層級對待辦工具是過度設計，
 * 而且會帶來循環參照的風險。
 */
export function groupByParent(tasks: readonly StoredTask[]): Map<string, StoredTask[]> {
  const map = new Map<string, StoredTask[]>()
  for (const task of tasks) {
    if (task.parentId === null) continue
    const list = map.get(task.parentId)
    if (list) list.push(task)
    else map.set(task.parentId, [task])
  }
  for (const list of map.values()) list.sort((a, b) => compareRankValues(a.rank, b.rank))
  return map
}

/** 父項的完成狀態：所有子項都完成才算完成。沒有子項時沿用自身狀態。 */
export function isEffectivelyComplete(task: StoredTask, children: readonly StoredTask[]): boolean {
  if (children.length === 0) return task.isCompleted
  return children.every((c) => c.isCompleted)
}
