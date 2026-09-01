import {
  DB_VERSION,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from './schema'
import { normalizeFilter, normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'

/**
 * 匯出與匯入。
 *
 * 這是純前端架構下最該補的一項：資料只活在這一台瀏覽器的 IndexedDB 裡，
 * 清一次瀏覽資料就全沒了，而且沒有任何搬到別台機器的路徑。
 *
 * 匯入走的是既有的 normalize* 函式，與 IndexedDB、舊版 localStorage 完全同一條
 * 邊界驗證路徑：備份檔是使用者可以手改的檔案，信任程度不會高於其他外部輸入。
 * 一筆壞資料只該讓那一筆消失，不該讓整份匯入失敗。
 *
 * 版號記的是 schema 版本，讓日後的舊檔升級有依據；
 * 目前所有版本的形狀差異都由 normalize* 吸收，不需要額外的轉換。
 */

export const BACKUP_FORMAT = 'todo-list-backup'

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  tasks: StoredTask[]
  projects: StoredProject[]
  tags: StoredTag[]
  filters: StoredFilter[]
}

export interface BackupPayload {
  tasks: readonly StoredTask[]
  projects: readonly StoredProject[]
  tags: readonly StoredTag[]
  filters: readonly StoredFilter[]
}

export interface ImportResult {
  data: BackupPayload
  /** 被濾掉的壞資料筆數，匯入後要讓使用者知道，不能默默吃掉。 */
  skipped: { tasks: number; projects: number; tags: number; filters: number }
}

export type ParseResult = { ok: true; result: ImportResult } | { ok: false; message: string }

export function createBackup(payload: BackupPayload, now: Date = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: DB_VERSION,
    exportedAt: now.toISOString(),
    tasks: payload.tasks.map((t) => ({ ...t, tagIds: [...t.tagIds] })),
    projects: payload.projects.map((p) => ({ ...p })),
    tags: payload.tags.map((t) => ({ ...t })),
    filters: payload.filters.map((f) => ({ ...f })),
  }
}

export function serializeBackup(payload: BackupPayload, now: Date = new Date()): string {
  // 縮排兩格：備份檔是使用者可能會打開來看、甚至手動修一行的東西
  return JSON.stringify(createBackup(payload, now), null, 2)
}

/** 檔名帶日期，一個資料夾裡放好幾份備份時才分得出哪份是哪份。 */
export function backupFilename(now: Date = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  return `todo-list-${iso}.json`
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 解析備份檔。
 *
 * 只有「根本不是這個格式」才整份拒絕；個別壞掉的列一律濾除並計數。
 * 分得開這兩種情況很重要：前者要請使用者換一個檔案，
 * 後者匯入是成功的，只是有幾筆救不回來。
 */
export function parseBackup(raw: unknown): ParseResult {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, message: '這個檔案不是有效的 JSON' }
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: '這個檔案不是備份檔' }
  }

  const record = value as Record<string, unknown>
  if (record.format !== BACKUP_FORMAT) {
    return { ok: false, message: '這個檔案不是本工具匯出的備份' }
  }

  const rawTasks = asArray(record.tasks)
  const rawProjects = asArray(record.projects)
  const rawTags = asArray(record.tags)
  const rawFilters = asArray(record.filters)

  const tasks = rawTasks
    .map((row, i) => normalizeTask(row, i))
    .filter((t): t is StoredTask => t !== null)
  const projects = rawProjects
    .map((row, i) => normalizeProject(row, i))
    .filter((p): p is StoredProject => p !== null)
  const tags = rawTags.map(normalizeTag).filter((t): t is StoredTag => t !== null)
  const filters = rawFilters
    .map((row, i) => normalizeFilter(row, i))
    .filter((f): f is StoredFilter => f !== null)

  return {
    ok: true,
    result: {
      data: { tasks, projects, tags, filters },
      skipped: {
        tasks: rawTasks.length - tasks.length,
        projects: rawProjects.length - projects.length,
        tags: rawTags.length - tags.length,
        filters: rawFilters.length - filters.length,
      },
    },
  }
}

/**
 * 合併匯入：同 id 以匯入的版本為準，其餘保留。
 *
 * 預設是合併而不是取代，因為「匯入」最常見的情境是把另一台機器的資料帶過來，
 * 而不是把這台的東西全部丟掉。要取代得明確選擇。
 */
export function mergeById<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}
