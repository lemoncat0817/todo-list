import type { DBSchema } from 'idb'
import type { Task } from '@/stores/sanitize'

export const DB_NAME = 'todolist'
export const DB_VERSION = 1

export const STORE_TASKS = 'tasks'
export const STORE_META = 'meta'

/** meta 用來記錄一次性遷移是否已完成，避免重複執行。 */
export const META_MIGRATED_FROM_LOCALSTORAGE = 'migratedFromLocalStorage'

export interface TodoDB extends DBSchema {
  [STORE_TASKS]: {
    key: string
    value: Task & { id: string; order: number }
    indexes: {
      'by-completed': 'true' | 'false'
      'by-order': number
    }
  }
  [STORE_META]: {
    key: string
    value: unknown
  }
}

/**
 * 儲存層的任務形狀。
 *
 * 相對於原本的記憶體形狀多了兩個欄位：
 * - id 收斂為字串（crypto.randomUUID），不再是 Date.now() 的數字（稽核 P17）
 * - order 是可插值的排序鍵，拖曳排序時只需改動一列而非重寫整份清單
 */
export interface StoredTask {
  id: string
  taskName: string
  isCompleted: boolean
  order: number
}
