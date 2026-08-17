import { openDB, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_TASK_FIELDS,
  STORE_META,
  STORE_PROJECTS,
  STORE_TAGS,
  STORE_TASKS,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from './schema'
import { normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'

/**
 * IndexedDB 的存取層。
 *
 * 這一層只做 IO 與形狀驗證，不含任何業務規則——排序數學在 domain/ordering，
 * 篩選在 domain/filtering。相依方向一律由外向內（db → domain），
 * 不會出現基礎設施回頭依賴 store 的情況。
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
          // v1 的任務只有四個欄位。先補齊 v2 新增的欄位，
          // 否則讀取端的正規化會因為缺欄位把整筆丟掉。
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

/**
 * 以單一交易覆寫整個 store。
 * 覆寫而非逐筆更新，是為了避免「刪除」在多分頁情境下漏掉。
 */
async function replaceAll<T>(storeName: string, rows: readonly T[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(storeName, 'readwrite')
  await tx.store.clear()
  for (const row of rows) await tx.store.put(row)
  await tx.done
}

// ---------------------------------------------------------------- tasks

/** 依 order 讀出全部任務；壞掉的列被正規化或略過，不讓整批失敗。 */
export async function loadTasks(): Promise<StoredTask[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_TASKS, 'by-order')
  return rows.map((row, i) => normalizeTask(row, i)).filter((t): t is StoredTask => t !== null)
}

export function saveTasks(tasks: readonly StoredTask[]): Promise<void> {
  return replaceAll(STORE_TASKS, tasks)
}

// ------------------------------------------------------------- projects

export async function loadProjects(): Promise<StoredProject[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_PROJECTS, 'by-order')
  return rows.map((row, i) => normalizeProject(row, i)).filter((p): p is StoredProject => p !== null)
}

export function saveProjects(projects: readonly StoredProject[]): Promise<void> {
  return replaceAll(STORE_PROJECTS, projects)
}

// ----------------------------------------------------------------- tags

export async function loadTags(): Promise<StoredTag[]> {
  const db = await getDB()
  const rows = await db.getAll(STORE_TAGS)
  return rows.map(normalizeTag).filter((t): t is StoredTag => t !== null)
}

export function saveTags(tags: readonly StoredTag[]): Promise<void> {
  return replaceAll(STORE_TAGS, tags)
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
