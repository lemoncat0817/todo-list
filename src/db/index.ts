import { openDB, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  STORE_META,
  STORE_TASKS,
  META_MIGRATED_FROM_LOCALSTORAGE,
  type StoredTask,
} from './schema'
import { sanitizeState } from '@/stores/sanitize'

/**
 * IndexedDB 資料層。
 *
 * 從 localStorage 換過來的理由：容量上限高出數個量級、支援索引查詢、
 * 且寫入是交易式的——localStorage 在寫到一半被中斷時可能留下截斷的 JSON。
 *
 * 這一層刻意只依賴 idb（實測 +1.18 kB gzip）而非 Dexie（+30.96 kB）：
 * 本專案只有兩個 object store，Dexie 的查詢 DSL 用不到。
 */

let dbPromise: Promise<IDBPDatabase> | null = null

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_TASKS)) {
          const tasks = db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
          tasks.createIndex('by-order', 'order')
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META)
        }
      },
    })
  }
  return dbPromise
}

/** 測試用：丟棄快取的連線，讓下次呼叫重新開啟。 */
export function resetDBCache(): void {
  dbPromise = null
}

function isStoredTask(v: unknown): v is StoredTask {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    t.id.length > 0 &&
    typeof t.taskName === 'string' &&
    t.taskName.length > 0 &&
    typeof t.isCompleted === 'boolean' &&
    typeof t.order === 'number' &&
    Number.isFinite(t.order)
  )
}

/** 依 order 由小到大讀出全部任務。壞掉的列會被略過而不是讓整批失敗。 */
export async function loadTasks(): Promise<StoredTask[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_TASKS, 'by-order')
  return rows.filter(isStoredTask)
}

/** 以單一交易覆寫整份清單，避免寫到一半的中間狀態被讀到。 */
export async function saveTasks(tasks: StoredTask[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_TASKS, 'readwrite')
  await tx.store.clear()
  for (const task of tasks) {
    await tx.store.put(task)
  }
  await tx.done
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return (await db.get(STORE_META, key)) as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put(STORE_META, value, key)
}

export interface MigrationResult {
  /** 是否實際執行了遷移（false 代表先前已完成，或沒有舊資料）。 */
  ran: boolean
  migrated: number
  skipped: number
}

/**
 * 一次性遷移：把舊版存在 localStorage 的資料搬進 IndexedDB。
 *
 * 設計上刻意保守：
 * - 逐筆通過 sanitize，壞資料被跳過並計數，而不是讓整批失敗
 * - 遷移完成才寫入 meta 標記；中途失敗下次會重試
 * - **不刪除 localStorage 的原始資料**，萬一需要回滾舊版仍讀得到
 */
export async function migrateFromLocalStorage(
  storageKey = 'todoTask',
): Promise<MigrationResult> {
  const done = await getMeta<boolean>(META_MIGRATED_FROM_LOCALSTORAGE)
  if (done) return { ran: false, migrated: 0, skipped: 0 }

  let raw: string | null
  try {
    raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null
  } catch {
    // Safari 停用 cookie 時存取 localStorage 會直接拋錯
    raw = null
  }

  if (raw === null) {
    await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)
    return { ran: false, migrated: 0, skipped: 0 }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 壞掉的 JSON 沒有救回的價值，標記完成避免每次開啟都重試
    await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)
    return { ran: true, migrated: 0, skipped: 0 }
  }

  const before = Array.isArray((parsed as { todoList?: unknown })?.todoList)
    ? ((parsed as { todoList: unknown[] }).todoList as unknown[]).length
    : 0
  const clean = sanitizeState(parsed).todoList ?? []

  const stored: StoredTask[] = clean.map((task, index) => ({
    id: typeof task.id === 'string' ? task.id : String(task.id),
    taskName: task.taskName,
    isCompleted: task.isCompleted,
    order: index,
  }))

  await saveTasks(stored)
  await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)

  return { ran: true, migrated: stored.length, skipped: Math.max(0, before - stored.length) }
}

/** 產生新任務用的排序鍵：接在目前最大值之後。 */
export function nextOrder(tasks: readonly StoredTask[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1
}
