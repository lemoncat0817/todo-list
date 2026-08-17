export const DB_NAME = 'todolist'
/** v1: tasks + meta。v2: 擴充任務欄位，新增 projects 與 tags。 */
export const DB_VERSION = 2

export const STORE_TASKS = 'tasks'
export const STORE_META = 'meta'
export const STORE_PROJECTS = 'projects'
export const STORE_TAGS = 'tags'

/** meta 用來記錄一次性遷移是否已完成，避免重複執行。 */
export const META_MIGRATED_FROM_LOCALSTORAGE = 'migratedFromLocalStorage'

/** 未分類：刪除專案時任務的去處，不是一筆真的 project 紀錄。 */
export const UNCATEGORIZED = null

export type Priority = 0 | 1 | 2 | 3
export const PRIORITY_LABELS: Record<Priority, string> = {
  0: '無',
  1: '低',
  2: '中',
  3: '高',
}

/** RFC 5545 的星期代碼，方便日後匯出 .ics 時直接對應。 */
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
}

/**
 * 重複規則。
 *
 * 欄位命名刻意對齊 RFC 5545（iCalendar）：freq / interval / byDay /
 * byMonthDay / until / count。日後若要支援 .ics 匯入匯出，
 * 換成 rrule 是「映射」而不是「資料遷移」。
 * 目前不引入 rrule —— 實測它要 +13.18 kB gzip，而這裡只需要常見的幾種規則。
 */
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly'
  /** 每 N 天 / 週 / 月，至少為 1。 */
  interval: number
  /** freq='weekly' 時指定星期幾；空陣列代表沿用起始日的星期。 */
  byDay: Weekday[]
  /** freq='monthly' 時指定每月幾號；null 代表沿用起始日。 */
  byMonthDay: number | null
  /** 結束日（含），格式 YYYY-MM-DD。 */
  until: string | null
  /** 總共重複幾次；與 until 擇一使用。 */
  count: number | null
}

export interface StoredTask {
  id: string
  taskName: string
  isCompleted: boolean
  /** 可插值的排序鍵：拖曳排序只需改動一列。 */
  order: number

  // --- v2 新增 ---
  notes: string
  priority: Priority
  /** YYYY-MM-DD，null 代表未設定到期日。 */
  dueDate: string | null
  /** HH:mm，需搭配 dueDate 才有意義。 */
  dueTime: string | null
  projectId: string | null
  tagIds: string[]
  /** 子任務的父項 id；null 代表頂層任務。 */
  parentId: string | null
  recurrence: Recurrence | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface StoredProject {
  id: string
  name: string
  color: string
  order: number
}

export interface StoredTag {
  id: string
  name: string
  color: string
}

/** v1 的任務形狀，遷移時用來辨識舊資料。 */
export interface LegacyTaskV1 {
  id: string
  taskName: string
  isCompleted: boolean
  order: number
}

export const DEFAULT_TASK_FIELDS: Omit<
  StoredTask,
  'id' | 'taskName' | 'isCompleted' | 'order' | 'createdAt' | 'updatedAt'
> = {
  notes: '',
  priority: 0,
  dueDate: null,
  dueTime: null,
  projectId: UNCATEGORIZED,
  tagIds: [],
  parentId: null,
  recurrence: null,
  completedAt: null,
}
