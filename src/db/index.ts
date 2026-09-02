/**
 * 資料層的對外介面。
 *
 * 對外只暴露這個 barrel，內部拆成三個關注點：
 *   schema.ts        形狀與常數
 *   repositories.ts  IO
 *   migrate.ts       舊版 localStorage 的一次性遷移
 *
 * 排序數學已移到 domain/ordering —— 那是純函式，不屬於資料層。
 */
export {
  getDB,
  resetDBCache,
  loadTasks,
  saveTasks,
  applyTaskChanges,
  type TaskChanges,
  loadProjects,
  saveProjects,
  loadTags,
  saveTags,
  loadFilters,
  saveFilters,
  loadComments,
  saveComments,
  getMeta,
  setMeta,
  loadOutbox,
  enqueueOp,
  removeOp,
  markOpAttempt,
  clearOutbox,
} from './repositories'

export { migrateFromLocalStorage, type MigrationResult } from './migrate'
