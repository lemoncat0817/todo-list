/**
 * 持久化狀態的邊界驗證（稽核 P2）。
 *
 * pinia-plugin-persistedstate 會把 JSON.parse 的結果直接餵給 store.$patch，
 * 沒有任何 schema 檢查。實測顯示壞資料會讓 todoHeader 與 todoFooter 整區
 * 渲染失敗，且 Vue 會攔截錯誤、不產生未捕捉例外 —— 使用者只看到元件消失，
 * 沒有任何訊息，也沒有復原路徑。
 *
 * 這裡在資料進入 store 之前就把它擋掉：形狀不對的一律丟棄，退回乾淨的預設值。
 */

/** 待辦事項的識別碼。Phase 4 遷移到 IndexedDB 時會統一為 crypto.randomUUID 的字串。 */
export type TaskId = number | string

export interface Task {
  id: TaskId
  taskName: string
  isCompleted: boolean
}

export interface PersistedState {
  todoList: Task[]
  isSearch: boolean
  keyword: string
}

/** taskName 只接受非空字串。App 本身只會寫入字串，其他型別必然是外部污染。 */
function isValidTaskName(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** id 接受數字或非空字串。 */
function isValidId(v: unknown): v is TaskId {
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && v.length > 0
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 單筆待辦事項的驗證。無法構成有效項目時回傳 null 由呼叫端濾除。
 * 注意輸出不含 isEdit —— 編輯狀態已改為元件區域狀態，不再持久化（稽核 P1）。
 */
export function sanitizeTask(raw: unknown): Task | null {
  if (!isRecord(raw)) return null
  if (!isValidId(raw.id) || !isValidTaskName(raw.taskName)) return null
  return {
    id: raw.id,
    taskName: raw.taskName,
    isCompleted: raw.isCompleted === true,
  }
}

/**
 * 整份持久化狀態的驗證。
 * 只挑出通過驗證的欄位；其餘一律不覆寫，讓 store 保留自己的預設值。
 */
export function sanitizeState(raw: unknown): Partial<PersistedState> {
  if (!isRecord(raw)) return {}

  const state: Partial<PersistedState> = {}
  if (Array.isArray(raw.todoList)) {
    state.todoList = raw.todoList
      .map(sanitizeTask)
      .filter((t): t is Task => t !== null)
  }
  if (typeof raw.isSearch === 'boolean') state.isSearch = raw.isSearch
  if (typeof raw.keyword === 'string') state.keyword = raw.keyword

  return state
}

/** 給 persist 選項使用的 serializer：反序列化時就把關。 */
export const safeSerializer = {
  serialize: (value: unknown): string => JSON.stringify(value),
  deserialize: (raw: string): Partial<PersistedState> => sanitizeState(JSON.parse(raw)),
}

export interface UiPrefs {
  isSearch: boolean
  keyword: string
}

/**
 * 留在 localStorage 的只剩搜尋這類 UI 偏好；任務本體已移往 IndexedDB。
 * 同樣要驗證形狀——這是稽核 P2 的教訓，任何外部來源都不能直接信任。
 */
export function sanitizeUiPrefs(raw: unknown): Partial<UiPrefs> {
  if (!isRecord(raw)) return {}

  const prefs: Partial<UiPrefs> = {}
  if (typeof raw.isSearch === 'boolean') prefs.isSearch = raw.isSearch
  if (typeof raw.keyword === 'string') prefs.keyword = raw.keyword
  return prefs
}
