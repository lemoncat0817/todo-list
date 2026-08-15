import { openDB, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_TASK_FIELDS,
  META_MIGRATED_FROM_LOCALSTORAGE,
  STORE_META,
  STORE_PROJECTS,
  STORE_TAGS,
  STORE_TASKS,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from './schema'
import { normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'
import { sanitizeState } from '@/stores/sanitize'

/**
 * IndexedDB 資料層。
 *
 * 從 localStorage 換過來的理由：容量上限高出數個量級、支援索引查詢、
 * 且寫入是交易式的——localStorage 在寫到一半被中斷時可能留下截斷的 JSON。
 *
 * 只依賴 idb（實測 +1.18 kB gzip）而非 Dexie（+30.96 kB）：
 * 本專案的查詢很單純，Dexie 的 DSL 用不到。
 */

let dbPromise: Promise<IDBPDatabase> | null = null

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const tasks = db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
          tasks.createIndex('by-order', 'order')
          db.createObjectStore(STORE_META)
        }

        if (oldVersion < 2) {
          // v1 的任務只有四個欄位，補齊 v2 新增的欄位後才不會讓
          // 讀取端的正規化把整筆丟掉。
          const store = tx.objectStore(STORE_TASKS)
          const existing = await store.getAll()
          const now = Date.now()
          for (const row of existing) {
            await store.put({
              ...DEFAULT_TASK_FIELDS,
              createdAt: now,
              updatedAt: now,
              ...(row as object),
            })
          }

          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            const projects = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
            projects.createIndex('by-order', 'order')
          }
          if (!db.objectStoreNames.contains(STORE_TAGS)) {
            db.createObjectStore(STORE_TAGS, { keyPath: 'id' })
          }
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

// ---------------------------------------------------------------- tasks

/** 依 order 由小到大讀出全部任務。壞掉的列會被正規化或略過，不讓整批失敗。 */
export async function loadTasks(): Promise<StoredTask[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_TASKS, 'by-order')
  return rows
    .map((row, i) => normalizeTask(row, i))
    .filter((t): t is StoredTask => t !== null)
}

/** 以單一交易覆寫整份清單，避免寫到一半的中間狀態被讀到。 */
export async function saveTasks(tasks: readonly StoredTask[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_TASKS, 'readwrite')
  await tx.store.clear()
  for (const task of tasks) {
    await tx.store.put(task)
  }
  await tx.done
}

// ------------------------------------------------------------- projects

export async function loadProjects(): Promise<StoredProject[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_PROJECTS, 'by-order')
  return rows
    .map((row, i) => normalizeProject(row, i))
    .filter((p): p is StoredProject => p !== null)
}

export async function saveProjects(projects: readonly StoredProject[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_PROJECTS, 'readwrite')
  await tx.store.clear()
  for (const project of projects) await tx.store.put(project)
  await tx.done
}

// ----------------------------------------------------------------- tags

export async function loadTags(): Promise<StoredTag[]> {
  const db = await getDB()
  const rows = await db.getAll(STORE_TAGS)
  return rows.map(normalizeTag).filter((t): t is StoredTag => t !== null)
}

export async function saveTags(tags: readonly StoredTag[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_TAGS, 'readwrite')
  await tx.store.clear()
  for (const tag of tags) await tx.store.put(tag)
  await tx.done
}

// ----------------------------------------------------------------- meta

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return (await db.get(STORE_META, key)) as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put(STORE_META, value, key)
}

// ------------------------------------------------------------ migration

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
 * - 逐筆通過驗證，壞資料被跳過並計數，而不是讓整批失敗
 * - 遷移完成才寫入 meta 標記；中途失敗下次會重試
 * - **不刪除 localStorage 的原始資料**，萬一需要回滾舊版仍讀得到
 */
export async function migrateFromLocalStorage(storageKey = 'todoTask'): Promise<MigrationResult> {
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

  const now = Date.now()
  const stored: StoredTask[] = clean.map((task, index) => ({
    ...DEFAULT_TASK_FIELDS,
    id: typeof task.id === 'string' ? task.id : String(task.id),
    taskName: task.taskName,
    isCompleted: task.isCompleted,
    order: index,
    completedAt: task.isCompleted ? now : null,
    createdAt: now,
    updatedAt: now,
  }))

  await saveTasks(stored)
  await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)

  return { ran: true, migrated: stored.length, skipped: Math.max(0, before - stored.length) }
}

/** 產生新任務用的排序鍵：接在目前最大值之後。 */
export function nextOrder(tasks: readonly { order: number }[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1
}

/**
 * 拖曳排序用：算出插入到 before / after 之間的排序鍵。
 * 用取中間值而非重編號，這樣一次拖曳只需要寫入一列。
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0
  if (before === null) return (after as number) - 1
  if (after === null) return before + 1
  return (before + after) / 2
}
