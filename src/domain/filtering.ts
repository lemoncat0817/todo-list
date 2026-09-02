import type { StoredTask } from '@/db/schema'
import { sortByRank } from './rank'

/**
 * 清單的篩選與搜尋。
 *
 * 抽成純函式而不是留在元件裡，有三個具體好處：
 * 1. 不需要掛載元件就能測，測試快且不脆弱
 * 2. 篩選規則只有一份，畫面與計數不會各自算出不同答案
 * 3. 元件回歸成「呈現」，不再兼職業務邏輯
 */

export type TaskFilter = 'all' | 'active' | 'completed'

export const TASK_FILTERS: readonly TaskFilter[] = ['all', 'active', 'completed']

/**
 * 搜尋用的字串正規化（稽核 P4）。
 *
 * NFKC 先把全形轉半形、合併相容字元，再轉小寫。
 * 一次解決三類問題：英文大小寫、全形半形、組合字。
 * 中文不受 NFKC 影響，行為不變。
 */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

export function matchesKeyword(task: StoredTask, keyword: string): boolean {
  const needle = normalizeForSearch(keyword)
  if (needle === '') return true
  return (
    normalizeForSearch(task.taskName).includes(needle) ||
    normalizeForSearch(task.notes).includes(needle)
  )
}

/**
 * 在專案／標籤這類「有名字的集合」裡找同名項目（大小寫、全形半形不分）。
 *
 * 泛型只要求 `name`，不綁定 `NamedCollection` 型別，避免 domain 內產生循環匯入
 * （`views.ts` 已經匯入本檔案的 `matchesKeyword`）。快速輸入解析
 * （`quickAdd.ts`）與專案／標籤的建立入口（`stores/collections.ts`）共用這一份，
 * 是同一個問題：兩者都要判斷「這個名字是不是已經存在」。
 */
export function findByNormalizedName<T extends { name: string }>(
  collection: readonly T[],
  name: string,
): T | null {
  const needle = normalizeForSearch(name)
  return collection.find((c) => normalizeForSearch(c.name) === needle) ?? null
}

export function matchesFilter(task: StoredTask, filter: TaskFilter): boolean {
  // filter 是封閉的字面量聯集，switch 有 default 收尾，
  // 型別層面就不可能出現「未涵蓋的值」（稽核 P3 的結構性解法）。
  switch (filter) {
    case 'active':
      return !task.isCompleted
    case 'completed':
      return task.isCompleted
    default:
      return true
  }
}

export interface TaskQuery {
  keyword?: string
  filter?: TaskFilter
  projectId?: string | null
  tagId?: string | null
}

/**
 * 套用查詢條件，回傳頂層任務（子任務跟著父項呈現，不佔清單一列）。
 * 結果依排序鍵排序。
 */
export function queryTasks(tasks: readonly StoredTask[], query: TaskQuery = {}): StoredTask[] {
  const { keyword = '', filter = 'all', projectId, tagId } = query

  const matched = tasks.filter((task) => {
    if (task.parentId !== null) return false
    if (!matchesKeyword(task, keyword)) return false
    if (!matchesFilter(task, filter)) return false
    if (projectId !== undefined && task.projectId !== projectId) return false
    if (tagId !== undefined && tagId !== null && !task.tagIds.includes(tagId)) return false
    return true
  })

  return sortByRank(matched)
}

/** 各分頁的項目數。與清單走同一條篩選路徑，數字不會對不上。 */
export function countByFilter(
  tasks: readonly StoredTask[],
  query: Omit<TaskQuery, 'filter'> = {},
): Record<TaskFilter, number> {
  return {
    all: queryTasks(tasks, { ...query, filter: 'all' }).length,
    active: queryTasks(tasks, { ...query, filter: 'active' }).length,
    completed: queryTasks(tasks, { ...query, filter: 'completed' }).length,
  }
}
