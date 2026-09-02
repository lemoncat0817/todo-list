import { openDB, type IDBPDatabase } from 'idb'
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_TASK_FIELDS,
  STORE_ACTIVITY,
  STORE_COMMENTS,
  STORE_FILTERS,
  STORE_META,
  STORE_OUTBOX,
  STORE_PROJECTS,
  STORE_TAGS,
  STORE_TASKS,
  type Op,
  type StoredActivity,
  type StoredComment,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from './schema'
import {
  normalizeActivity,
  normalizeComment,
  normalizeFilter,
  normalizeOp,
  normalizeProject,
  normalizeTag,
  normalizeTask,
} from '@/domain/task'
import { nextRank } from '@/domain/rank'

/**
 * IndexedDB 的存取層。
 *
 * 這一層只做 IO 與形狀驗證，不含任何業務規則——排序數學在 domain/rank，
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

        if (oldVersion < 4) {
          // 同上，全新的 store，沒有既有資料要搬。
          if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
            const outbox = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' })
            outbox.createIndex('by-createdAt', 'createdAt')
          }
        }

        if (oldVersion < 5) {
          // order（浮點數）→ rank（字串，domain/rank.ts）。tags 沒有這個
          // 欄位，只動 tasks／projects／filters。既有列依原本的 order
          // 由小到大排序後，依序指派新的 rank，維持原本的相對順序；
          // 新舊索引一起換，不是留著 by-order 不管——名字對不上實際
          // 排序鍵，留著只會誤導以後的人。
          for (const storeName of [STORE_TASKS, STORE_PROJECTS, STORE_FILTERS]) {
            const store = tx.objectStore(storeName)
            const existing = ((await store.getAll()) as Record<string, unknown>[]).sort(
              (a, b) => (typeof a.order === 'number' ? a.order : 0) - (typeof b.order === 'number' ? b.order : 0),
            )
            let ranked: { id: string; rank: string }[] = []
            for (const row of existing) {
              const rank = nextRank(ranked)
              ranked = [...ranked, { id: String(row.id), rank }]
              delete row.order
              row.rank = rank
              await store.put(row)
            }
            store.deleteIndex('by-order')
            store.createIndex('by-rank', 'rank')
          }
        }

        if (oldVersion < 6) {
          // 全新的 store，沒有既有資料要搬。索引依 taskId：畫面只會
          // 一次讀「這筆任務的留言」，不會整表掃描。
          if (!db.objectStoreNames.contains(STORE_COMMENTS)) {
            const comments = db.createObjectStore(STORE_COMMENTS, { keyPath: 'id' })
            comments.createIndex('by-taskId', 'taskId')
          }
        }

        if (oldVersion < 7) {
          // 同上，全新的 store，沒有既有資料要搬。
          if (!db.objectStoreNames.contains(STORE_ACTIVITY)) {
            const activity = db.createObjectStore(STORE_ACTIVITY, { keyPath: 'id' })
            activity.createIndex('by-taskId', 'taskId')
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
/**
 * IndexedDB 的 put() 底層用 structured clone，認不得 Vue 的 reactive
 * Proxy——巢狀的陣列／物件欄位（tagIds、recurrence、mentionedUserIds、
 * detail……）一旦被 push 進某個 store 的 reactive ref，就會變成 Proxy，
 * 直接丟給 put() 會丟 DataCloneError。呼叫端已經各自在自己的
 * snapshot()／flush() 裡 toRaw 過一次，這裡是最後一道防線：同一個坑
 * 在這個專案裡至少踩過三次（tasks 的 tagIds／recurrence、comments 的
 * mentionedUserIds、activity 的 detail），每次都要在新 store 裡重新
 * 記得處理，不如在真正寫入 IndexedDB 的這一個出口統一擋下來。
 *
 * 用 JSON 往返而不是 structuredClone()：structuredClone 走的是同一套
 * 底層引擎演算法，一樣不認得 reactive Proxy，會踩到一模一樣的錯誤——
 * 這裡要的是「透過一般的屬性存取讀過一輪」，JSON.stringify 的物件遍歷
 * 正是這種讀法，Proxy 的 get trap 會被正常觸發。這個專案的資料形狀
 * 全部是純量／陣列／物件（沒有 Date、Map 這類 JSON 不保真的型別，
 * 見 domain/dates.ts 對日期一律存字串的說明），JSON 往返不會遺失資訊。
 */
function toPlain<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T
}

async function replaceAll<T>(storeName: string, rows: readonly T[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(storeName, 'readwrite')
  await tx.store.clear()
  for (const row of rows) await tx.store.put(toPlain(row))
  await tx.done
}

// ---------------------------------------------------------------- tasks

/** 依 rank 讀出全部任務；壞掉的列被正規化或略過，不讓整批失敗。 */
export async function loadTasks(): Promise<StoredTask[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_TASKS, 'by-rank')
  return rows.map((row, i) => normalizeTask(row, String(i))).filter((t): t is StoredTask => t !== null)
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
  for (const row of changes.upserts) await tx.store.put(toPlain(row))
  await tx.done
}

// ------------------------------------------------------------- projects

export async function loadProjects(): Promise<StoredProject[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_PROJECTS, 'by-rank')
  return rows.map((row, i) => normalizeProject(row, String(i))).filter((p): p is StoredProject => p !== null)
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
  const rows = await db.getAllFromIndex(STORE_FILTERS, 'by-rank')
  return rows.map((row, i) => normalizeFilter(row, String(i))).filter((f): f is StoredFilter => f !== null)
}

export function saveFilters(filters: readonly StoredFilter[]): Promise<void> {
  return replaceAll(STORE_FILTERS, filters)
}

// ---------------------------------------------------------------- comments

/**
 * 整份載入，跟 loadTasks 同一個模式——留言的量級（個人／小團隊的待辦
 * 協作）不值得為了「只讀目前這筆任務的留言」另外做分頁查詢，store
 * 端用 taskId 在記憶體裡篩就好。依 createdAt 排序：留言天生是時間序，
 * 不像 tasks/projects/filters 需要使用者自訂的 rank。
 */
export async function loadComments(): Promise<StoredComment[]> {
  const db = await getDB()
  const rows = await db.getAll(STORE_COMMENTS)
  return rows
    .map((row) => normalizeComment(row))
    .filter((c): c is StoredComment => c !== null)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function saveComments(comments: readonly StoredComment[]): Promise<void> {
  return replaceAll(STORE_COMMENTS, comments)
}

// ---------------------------------------------------------------- activity

/** 純粹是拉取進來的快取，見 db/schema.ts 的 StoredActivity 說明——這裡沒有對應的寫入方法給使用者操作。 */
export async function loadActivity(): Promise<StoredActivity[]> {
  const db = await getDB()
  const rows = await db.getAll(STORE_ACTIVITY)
  return rows
    .map((row) => normalizeActivity(row))
    .filter((a): a is StoredActivity => a !== null)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function saveActivity(activity: readonly StoredActivity[]): Promise<void> {
  return replaceAll(STORE_ACTIVITY, activity)
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

// ---------------------------------------------------------------- outbox

/** 依 createdAt 讀出全部待送操作；壞掉的列被正規化或略過，不讓上傳器整批卡住。 */
export async function loadOutbox(): Promise<Op[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(STORE_OUTBOX, 'by-createdAt')
  return rows.map(normalizeOp).filter((op): op is Op => op !== null)
}

/** 使用者做了一個動作就呼叫一次，把操作記進佇列。 */
export async function enqueueOp(op: Op): Promise<void> {
  const db = await getDB()
  // op.payload 常常是陣列／物件欄位的補丁（tag_ids、mentioned_user_ids……），
  // 呼叫端沒記得先 toRaw 的話一樣會踩 replaceAll() 旁註解說的那個坑。
  await db.put(STORE_OUTBOX, toPlain(op))
}

/** 操作送達伺服器後從佇列移除。 */
export async function removeOp(id: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE_OUTBOX, id)
}

/** 送出失敗時記一次重試，供上傳器算退避間隔。 */
export async function markOpAttempt(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(STORE_OUTBOX, 'readwrite')
  const row = await tx.store.get(id)
  if (row) await tx.store.put({ ...row, attempts: (row as Op).attempts + 1 })
  await tx.done
}

/**
 * 清空整個佇列。換帳號登入時用（見 stores/sync.ts 的
 * reconcileAccountIdentity）——上一個帳號還沒送出的操作，不該用
 * 這次新登入的身分／token 送出去，那些列本來就不屬於新帳號。
 */
export async function clearOutbox(): Promise<void> {
  const db = await getDB()
  await db.clear(STORE_OUTBOX)
}
