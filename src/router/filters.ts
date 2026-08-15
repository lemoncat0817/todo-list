/**
 * 篩選的定義。
 *
 * 刻意獨立成一個不 import 任何元件的模組：
 * router/index.ts 需要 import 元件，元件又需要 FILTERS，
 * 兩者放在同一個檔案會形成循環相依，導致先載入元件時路由表的
 * component 還是 undefined（測試環境會直接踩到，正式環境只是碰巧
 * 靠 import 順序沒出事）。
 */
export type TaskFilter = 'all' | 'active' | 'completed'

export interface FilterTab {
  filter: TaskFilter
  label: string
  path: string
}

export const FILTERS: readonly FilterTab[] = [
  { filter: 'all', label: '全部', path: '/' },
  { filter: 'active', label: '未完成', path: '/active' },
  { filter: 'completed', label: '完成', path: '/completed' },
]
