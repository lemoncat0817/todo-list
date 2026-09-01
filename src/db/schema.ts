export const DB_NAME = 'todolist'
/**
 * v1: tasks + meta。
 * v2: 擴充任務欄位，新增 projects 與 tags。
 * v3: 新增 filters（儲存的篩選器查詢）。
 *
 * projects／tags／filters 後來補上的 updatedAt（跨裝置同步要用它判斷哪一邊
 * 較新，見 sync/merge.ts）不需要新的版號：IndexedDB 的 object store 本來就
 * 沒有固定 schema，新增欄位不需要 upgrade() 搬資料，既有列在讀取時
 * 由 normalizeProject/normalizeTag/normalizeFilter 補上 updatedAt（缺值時
 * 視為現在）即可，跟其他任何邊界正規化走同一條路。只有新增／變動 store
 * 或 index 結構才需要真的動版號。
 */
export const DB_VERSION = 3

export const STORE_TASKS = 'tasks'
export const STORE_META = 'meta'
export const STORE_PROJECTS = 'projects'
export const STORE_TAGS = 'tags'
export const STORE_FILTERS = 'filters'

/** meta 用來記錄一次性遷移是否已完成，避免重複執行。 */
export const META_MIGRATED_FROM_LOCALSTORAGE = 'migratedFromLocalStorage'

/**
 * 同步游標。放在 IndexedDB 的 meta 而不是 localStorage：這些數字要跟本地
 * 資料的生命週期綁在一起——清掉 IndexedDB 時游標也該歸零，下次同步才會
 * 從頭拉一次而不是誤以為早就同步過。
 *
 * FINGERPRINT_* 存的是「上次成功推送到遠端時，每一列的內容序列化字串」，
 * 讓離線時刪除的任務也能在重新連線後正確產生墓碑——這份指紋必須跨重新整理
 * 存活，跟 stores/tasks.ts 裡只在單一工作階段內有效的 persistedIndex
 * 是兩個不同的東西：那份記的是「IndexedDB 裡有什麼」，這份記的是
 * 「伺服器上有什麼」。
 */
export const META_SYNC_LAST_PULLED_AT = 'syncLastPulledAt'
export const META_SYNC_FINGERPRINT_TASKS = 'syncFingerprintTasks'
export const META_SYNC_FINGERPRINT_PROJECTS = 'syncFingerprintProjects'
export const META_SYNC_FINGERPRINT_TAGS = 'syncFingerprintTags'
export const META_SYNC_FINGERPRINT_FILTERS = 'syncFingerprintFilters'

/** 未分類：刪除專案時任務的去處，不是一筆真的 project 紀錄。 */
export const UNCATEGORIZED = null

export type Priority = 0 | 1 | 2 | 3

/**
 * 選單與快捷鍵一律走這個順序：最重要的排最前面。
 * 內部值維持 0–3（3 最高）以免資料遷移，但對外一律用主流待辦工具常見的 P1–P4
 * ——P1 是最高，這是許多使用者已經帶著的直覺，改內部值不值得。
 */
export const PRIORITY_ORDER: readonly Priority[] = [3, 2, 1, 0]

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'P4',
  1: 'P3',
  2: 'P2',
  3: 'P1',
}

/** 選單用：光看 P1 分不出高低，補上中文說明。 */
export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  0: 'P4（無）',
  1: 'P3（低）',
  2: 'P2（中）',
  3: 'P1（高）',
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
  /** v4 新增，供跨裝置同步判斷衝突時哪一邊較新（見 sync/merge.ts）。 */
  updatedAt: number
}

export interface StoredTag {
  id: string
  name: string
  color: string
  updatedAt: number
}

/**
 * 儲存的篩選器。
 *
 * query 存的是原始查詢字串而不是解析後的 AST：AST 的形狀會隨語言演進而改變，
 * 存字串則永遠可以用新的解析器重新讀一次，不需要資料遷移。
 */
export interface StoredFilter {
  id: string
  name: string
  query: string
  color: string
  order: number
  updatedAt: number
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

/**
 * 專案與標籤的可選顏色。
 *
 * 用固定調色盤而非自由選色器有兩個理由：自由選色讓使用者能選出在深色模式下
 * 讀不到的顏色，而這裡的顏色只出現在小圓點上，色相太接近反而分不出來。
 * 十二色已經超過大多數人實際會建立的專案數。
 */
export interface CollectionColor {
  name: string
  value: string
}

export const COLLECTION_COLORS: readonly CollectionColor[] = [
  { name: '靛藍', value: '#1d4ed8' },
  { name: '天藍', value: '#0284c7' },
  { name: '青綠', value: '#0d9488' },
  { name: '森綠', value: '#15803d' },
  { name: '萊姆', value: '#65a30d' },
  { name: '琥珀', value: '#d97706' },
  { name: '橘', value: '#ea580c' },
  { name: '紅', value: '#dc2626' },
  { name: '玫瑰', value: '#e11d48' },
  { name: '紫', value: '#7c3aed' },
  { name: '洋紅', value: '#c026d3' },
  { name: '石墨', value: '#64748b' },
]

export const DEFAULT_PROJECT_COLOR = '#1d4ed8'
export const DEFAULT_TAG_COLOR = '#15803d'
export const DEFAULT_FILTER_COLOR = '#7c3aed'
