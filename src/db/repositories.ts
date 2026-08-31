import { openDB, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_TASK_FIELDS,
  STORE_FILTERS,
  STORE_META,
  STORE_PROJECTS,
  STORE_TAGS,
  STORE_TASKS,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from './schema'
import { normalizeFilter, normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'

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

        if (oldVersion < 3) {
          // 全新的 store，沒有既有資料要搬——舊版使用者升上來就是一份空清單
          if (!db.objectStoreNames.contains(STORE_FILTERS)) {
            const filters = db.createObjectStore(STORE_FILTERS, { keyPath: 'id' })
            filters.createIndex('by-order', 'order')
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

/** 整份覆寫。匯入或首次寫入時用；一般變更走 applyTaskChanges。 */
export function saveTasks(tasks: readonly StoredTask[]): Promise<void> {
  return replaceAll(STORE_TASKS, tasks)
}

export interface TaskChanges {
  upserts: readonly StoredTask[]
  deletes: readonly string[]
}

/**
 * 只寫真的變動的列。
 *
 * 先前每一次變更都是 clear() 再把全部任務重寫一遍——幾十筆沒感覺，
 * 上千筆時每打一個勾都要重寫整張表。刪除靠 deletes 明確表達，
 * 所以不再需要用「整份覆寫」來保證刪掉的列真的消失。
 *
 * 附帶的好處：不再會把別的分頁剛新增的列一起清掉。
 */
export async function applyTaskChanges(changes: TaskChanges): Promise<void> {
  if (changes.upserts.length === 0 && changes.deletes.length === 0) return
  const db = await getDB()
  const tx = db.transaction(STORE_TASKS, 'readwrite')
  for (const id of changes.deletes) await tx.store.delete(id)
  for (const row of changes.upserts) await tx.store.put(row)
  await tx.done
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

// -------------------------------------------------------------- filters

export async function loadFilters(): Promise<StoredFilter[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_FILTERS, 'by-order')
  return rows.map((row, i) => normalizeFilter(row, i)).filter((f): f is StoredFilter => f !== null)
}

export function saveFilters(filters: readonly StoredFilter[]): Promise<void> {
  return replaceAll(STORE_FILTERS, filters)
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
