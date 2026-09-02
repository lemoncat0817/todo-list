import { DEFAULT_TASK_FIELDS, META_MIGRATED_FROM_LOCALSTORAGE, type StoredTask } from './schema'
import { getMeta, setMeta, saveTasks } from './repositories'
import { nextRank } from '@/domain/rank'

/**
 * 從舊版 localStorage 遷移到 IndexedDB。
 *
 * 這一層刻意不依賴 stores —— 基礎設施依賴狀態層是相依方向反了。
 * 舊格式的解析寫在這裡，因為「舊格式長什麼樣」本來就是遷移的知識，
 * 不該汙染現行的領域模型。
 */

/** 舊版存在 localStorage 的形狀。只列出遷移用得到的欄位。 */
interface LegacyTask {
  id: unknown
  taskName: unknown
  isCompleted: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 舊資料的驗證。無法構成有效任務者回傳 null 由呼叫端濾除並計數。
 * 舊版的 id 可能是數字（Date.now()），統一轉成字串。
 */
function parseLegacyTask(raw: unknown): { id: string; taskName: string; isCompleted: boolean } | null {
  if (!isRecord(raw)) return null
  const { id, taskName, isCompleted } = raw as unknown as LegacyTask

  const validName = typeof taskName === 'string' && taskName.length > 0
  if (!validName) return null

  let validId: string | null = null
  if (typeof id === 'string' && id.length > 0) validId = id
  else if (typeof id === 'number' && Number.isFinite(id)) validId = String(id)
  if (validId === null) return null

  return { id: validId, taskName: taskName as string, isCompleted: isCompleted === true }
}

export interface MigrationResult {
  /** 是否實際搬過資料（false 代表先前已完成，或沒有舊資料）。 */
  ran: boolean
  migrated: number
  skipped: number
}

function readLegacy(storageKey: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null
  } catch {
    // Safari 停用 cookie 時存取 localStorage 會直接拋錯
    return null
  }
}

/**
 * 一次性遷移。設計上刻意保守：
 * - 逐筆驗證，壞資料被跳過並計數，而不是讓整批失敗
 * - 完成才寫入標記；中途失敗下次會重試
 * - **不刪除 localStorage 的原始資料**，保留回滾舊版的可能
 */
export async function migrateFromLocalStorage(storageKey = 'todoTask'): Promise<MigrationResult> {
  if (await getMeta<boolean>(META_MIGRATED_FROM_LOCALSTORAGE)) {
    return { ran: false, migrated: 0, skipped: 0 }
  }

  const raw = readLegacy(storageKey)
  if (raw === null) {
    await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)
    return { ran: false, migrated: 0, skipped: 0 }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 壞掉的 JSON 沒有救回的價值；標記完成避免每次開啟都重試
    await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)
    return { ran: true, migrated: 0, skipped: 0 }
  }

  const list = isRecord(parsed) && Array.isArray(parsed.todoList) ? parsed.todoList : []
  const now = Date.now()
  const stored: StoredTask[] = []

  for (const item of list) {
    const legacy = parseLegacyTask(item)
    if (legacy === null) continue
    stored.push({
      ...DEFAULT_TASK_FIELDS,
      id: legacy.id,
      taskName: legacy.taskName,
      isCompleted: legacy.isCompleted,
      rank: nextRank(stored),
      completedAt: legacy.isCompleted ? now : null,
      createdAt: now,
      updatedAt: now,
    })
  }

  await saveTasks(stored)
  await setMeta(META_MIGRATED_FROM_LOCALSTORAGE, true)

  return { ran: true, migrated: stored.length, skipped: list.length - stored.length }
}
