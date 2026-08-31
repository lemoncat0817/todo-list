import type { StoredTask } from '@/db/schema'
import { addDays, compareISODate, daysUntil, today as todayOf } from './dates'
import { matchesKeyword } from './filtering'
import { sortByOrder } from './ordering'

/**
 * 檢視（view）。
 *
 * filtering.ts 回答的是「這筆任務符不符合條件」，這一層回答的是
 * 「使用者現在點的這個入口該看到什麼、怎麼分組」。分開的理由是它們的
 * 變化率不同：篩選述詞很穩定，而檢視是產品決策，會一直增加。
 *
 * 一樣是純函式、零 IO：側邊欄的計數與清單本體走同一條路徑，
 * 沿用 filtering.ts 立下的規矩——數字與內容不可能對不上。
 */

export type ViewKind =
  | 'today'
  | 'upcoming'
  | 'inbox'
  | 'all'
  | 'active'
  | 'completed'
  | 'project'
  | 'label'
  | 'filter'

export interface ViewSpec {
  kind: ViewKind
  /** project / label 檢視的目標 id；其餘檢視為 null。 */
  id: string | null
}

/** 「即將到來」往前看幾天。七天是一週的自然單位，再長就失去「即將」的意思。 */
export const UPCOMING_DAYS = 7

/** 排序方式。manual 是拖曳出來的順序，也是預設——那是使用者自己的判斷。 */
export type SortKey = 'manual' | 'due' | 'priority' | 'name' | 'created'

export const SORT_LABELS: Record<SortKey, string> = {
  manual: '手動順序',
  due: '到期日',
  priority: '優先度',
  name: '名稱',
  created: '建立時間',
}

/** 分組方式。日期軸的檢視（今天／即將到來）自帶分組，不受這個設定影響。 */
export type GroupKey = 'none' | 'project' | 'priority'

export const GROUP_LABELS: Record<GroupKey, string> = {
  none: '不分組',
  project: '專案',
  priority: '優先度',
}

export interface ViewOptions {
  keyword?: string
  now?: Date
  sort?: SortKey
  groupBy?: GroupKey
  /** 分組標題需要專案名稱；沒有傳就退回「未分類」之類的通用標題。 */
  projects?: readonly NamedCollection[]
  /**
   * filter 檢視專用的述詞（由 domain/filterQuery 編譯而來）。
   * 傳 null 代表查詢寫錯了——此時不回傳任何任務，
   * 讓畫面能說「查詢有問題」而不是假裝「沒有符合的項目」。
   */
  predicate?: ((task: StoredTask) => boolean) | null
}

/**
 * 一筆任務屬不屬於某個檢視。
 *
 * 「今天」與「即將到來」都把逾期任務算進來，這是刻意的：逾期的事不會因為
 * 日期過了就不用做，把它藏在昨天等於讓使用者永遠看不到它。Todoist 同樣如此。
 */
export function matchesView(task: StoredTask, spec: ViewSpec, now: Date = new Date()): boolean {
  switch (spec.kind) {
    case 'today':
      return (
        !task.isCompleted && task.dueDate !== null && compareISODate(task.dueDate, todayOf(now)) <= 0
      )
    case 'upcoming':
      return (
        !task.isCompleted &&
        task.dueDate !== null &&
        compareISODate(task.dueDate, addDays(todayOf(now), UPCOMING_DAYS - 1)) <= 0
      )
    case 'inbox':
      return !task.isCompleted && task.projectId === null
    case 'active':
      return !task.isCompleted
    case 'completed':
      return task.isCompleted
    // 專案／標籤檢視排除已完成，與收件匣一致：已完成的事屬於「已完成」那個
    // 歷史檢視，混在專案清單裡只會讓每天要看的東西愈積愈長。
    case 'project':
      return !task.isCompleted && task.projectId === spec.id
    case 'label':
      return !task.isCompleted && spec.id !== null && task.tagIds.includes(spec.id)
    // filter 檢視的條件完全由外部述詞決定，這裡不做額外限制
    case 'filter':
      return true
    default:
      return true
  }
}

export interface TaskGroup {
  key: string
  /** 分組標題；空字串代表這個檢視不分組，不要畫標題。 */
  label: string
  tasks: StoredTask[]
}

/**
 * 排序：先照到期日（沒有到期日的排最後），同日再照手動順序。
 *
 * 日期優先而非純手動順序，是因為進到這裡的檢視都是以時間為軸的；
 * 專案／全部等檢視則維持純手動順序，使用者自己排的次序才是那裡的第一語意。
 */
function byDueThenOrder(tasks: readonly StoredTask[]): StoredTask[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return compareISODate(a.dueDate, b.dueDate)
    }
    return a.order - b.order
  })
}

/**
 * 使用者選擇的排序。
 *
 * 每一種都以 order 收尾當作穩定的最後依據：少了它，兩筆同優先度的任務
 * 會在每次重新渲染時互換位置——排序看起來就像壞掉。
 */
export function sortTasks(tasks: readonly StoredTask[], key: SortKey = 'manual'): StoredTask[] {
  const list = [...tasks]
  switch (key) {
    case 'due':
      return list.sort((a, b) => {
        if (a.dueDate !== b.dueDate) {
          // 沒有到期日的排最後：它們不是「很早要做」，而是「沒排」
          if (a.dueDate === null) return 1
          if (b.dueDate === null) return -1
          return compareISODate(a.dueDate, b.dueDate)
        }
        return a.order - b.order
      })
    case 'priority':
      // priority 內部值愈大愈重要，所以由大到小
      return list.sort((a, b) => b.priority - a.priority || a.order - b.order)
    case 'name':
      return list.sort(
        (a, b) => a.taskName.localeCompare(b.taskName, 'zh-Hant') || a.order - b.order,
      )
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt || a.order - b.order)
    default:
      return sortByOrder(list)
  }
}

function dateGroupLabel(iso: string, now: Date): string {
  const diff = daysUntil(iso, now)
  if (diff === 0) return `今天 · ${iso}`
  if (diff === 1) return `明天 · ${iso}`
  return iso
}

/**
 * 把一個檢視解析成可直接渲染的分組清單。
 *
 * 空的分組會被濾掉——顯示一個標題底下什麼都沒有，只會讓人以為壞了。
 */
export function resolveView(
  tasks: readonly StoredTask[],
  spec: ViewSpec,
  options: ViewOptions = {},
): TaskGroup[] {
  const { keyword = '', now = new Date() } = options

  // filter 檢視在查詢寫錯時 predicate 是 null：一筆都不回傳，
  // 由畫面說明「查詢有問題」，而不是假裝條件成立但沒有結果。
  if (spec.kind === 'filter' && (options.predicate === null || options.predicate === undefined)) {
    return []
  }
  const predicate = options.predicate ?? (() => true)

  const matched = tasks.filter(
    (task) =>
      task.parentId === null &&
      matchesKeyword(task, keyword) &&
      matchesView(task, spec, now) &&
      (spec.kind !== 'filter' || predicate(task)),
  )

  const groups = buildGroups(matched, spec, now, options)
  return groups.filter((g) => g.tasks.length > 0)
}

function buildGroups(
  matched: StoredTask[],
  spec: ViewSpec,
  now: Date,
  options: ViewOptions,
): TaskGroup[] {
  const todayISO = todayOf(now)
  const sort = options.sort ?? 'manual'
  const groupBy = options.groupBy ?? 'none'

  if (spec.kind === 'today') {
    const overdue = matched.filter((t) => t.dueDate !== null && t.dueDate < todayISO)
    const due = matched.filter((t) => t.dueDate === todayISO)
    return [
      { key: 'overdue', label: `逾期 ${overdue.length}`, tasks: byDueThenOrder(overdue) },
      { key: todayISO, label: `今天 · ${todayISO}`, tasks: byDueThenOrder(due) },
    ]
  }

  if (spec.kind === 'upcoming') {
    const overdue = matched.filter((t) => t.dueDate !== null && t.dueDate < todayISO)
    const groups: TaskGroup[] = [
      { key: 'overdue', label: `逾期 ${overdue.length}`, tasks: byDueThenOrder(overdue) },
    ]
    for (let i = 0; i < UPCOMING_DAYS; i++) {
      const iso = addDays(todayISO, i)
      groups.push({
        key: iso,
        label: dateGroupLabel(iso, now),
        tasks: byDueThenOrder(matched.filter((t) => t.dueDate === iso)),
      })
    }
    return groups
  }

  if (spec.kind === 'completed' && sort === 'manual') {
    // 已完成是歷史紀錄，最近完成的排最前面才符合「回顧」的閱讀順序
    const sorted = [...matched].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return [{ key: 'completed', label: '', tasks: sorted }]
  }

  if (groupBy === 'project') {
    const byProject = new Map<string, StoredTask[]>()
    for (const task of matched) {
      const key = task.projectId ?? ''
      const bucket = byProject.get(key)
      if (bucket) bucket.push(task)
      else byProject.set(key, [task])
    }
    // 未分類固定排最後：它是「還沒決定」，不是一個跟其他專案並列的專案
    const keys = [...byProject.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0))
    return keys.map((key) => ({
      key: key === '' ? 'uncategorized' : key,
      label:
        key === ''
          ? '未分類'
          : (options.projects?.find((p) => p.id === key)?.name ?? '未分類'),
      tasks: sortTasks(byProject.get(key) ?? [], sort),
    }))
  }

  if (groupBy === 'priority') {
    return PRIORITY_GROUP_ORDER.map((priority) => ({
      key: `p${4 - priority}`,
      label: `P${4 - priority}`,
      tasks: sortTasks(
        matched.filter((t) => t.priority === priority),
        sort,
      ),
    }))
  }

  return [{ key: 'all', label: '', tasks: sortTasks(matched, sort) }]
}

/** 由高到低：3 是內部最高值，對外顯示為 P1。 */
const PRIORITY_GROUP_ORDER = [3, 2, 1, 0] as const

/** 側邊欄徽章用的數量。與清單走同一條路徑，不會出現「顯示 3 但列出 2」。 */
export function viewCount(
  tasks: readonly StoredTask[],
  spec: ViewSpec,
  options: ViewOptions = {},
): number {
  return resolveView(tasks, spec, options).reduce((sum, g) => sum + g.tasks.length, 0)
}

/** 逾期任務數，供「今天」入口顯示警示。 */
export function overdueCount(tasks: readonly StoredTask[], now: Date = new Date()): number {
  const todayISO = todayOf(now)
  return tasks.filter(
    (t) => !t.isCompleted && t.parentId === null && t.dueDate !== null && t.dueDate < todayISO,
  ).length
}

export interface NamedCollection {
  id: string
  name: string
}

/**
 * 檢視的標題與空狀態文案。
 *
 * 放在 domain 而不是元件裡，是因為它們是「這個檢視代表什麼」的一部分：
 * 標題與該檢視收錄哪些任務必須一致，分開寫遲早會出現標題說「今天」、
 * 內容卻是全部的情況。專案／標籤名稱以參數傳入，這一層仍然零相依。
 */
export function viewTitle(
  spec: ViewSpec,
  collections: { projects?: readonly NamedCollection[]; tags?: readonly NamedCollection[] } = {},
): string {
  switch (spec.kind) {
    case 'today':
      return '今天'
    case 'upcoming':
      return '即將到來'
    case 'inbox':
      return '收件匣'
    case 'active':
      return '未完成'
    case 'completed':
      return '已完成'
    case 'project':
      return collections.projects?.find((p) => p.id === spec.id)?.name ?? '找不到這個專案'
    case 'label':
      return `#${collections.tags?.find((t) => t.id === spec.id)?.name ?? '找不到這個標籤'}`
    case 'filter':
      return spec.id ?? '篩選器'
    default:
      return '全部'
  }
}

/** 空狀態的說明。搜尋無結果優先，因為那才是使用者當下看不到東西的真正原因。 */
export function emptyMessage(spec: ViewSpec, keyword = ''): string {
  if (keyword !== '') return `找不到符合「${keyword}」的代辦事項`
  switch (spec.kind) {
    case 'today':
      return '今天沒有到期的事，很好'
    case 'upcoming':
      return `未來 ${UPCOMING_DAYS} 天沒有到期的事`
    case 'inbox':
      return '收件匣是空的，新增的事會先落在這裡'
    case 'active':
      return '沒有未完成的代辦事項'
    case 'completed':
      return '還沒有已完成的代辦事項'
    case 'project':
      return '這個專案還沒有任務'
    case 'label':
      return '這個標籤還沒有任務'
    case 'filter':
      return '沒有符合這個查詢的代辦事項'
    default:
      return '目前沒有代辦事項，從上方新增一筆吧'
  }
}
