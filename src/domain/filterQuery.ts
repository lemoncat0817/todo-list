import type { StoredTask } from '@/db/schema'
import { compareISODate, today as todayOf } from './dates'
import { matchesKeyword, normalizeForSearch } from './filtering'
import type { NamedCollection } from './views'

/**
 * 篩選器查詢語言。
 *
 * 純文字關鍵字只能回答「名稱或備註裡有沒有這幾個字」，回答不了
 * 「這週到期、還沒完成、屬於工作、而且不是低優先度的事」。
 * 那種問題才是待辦工具真正要處理的。
 *
 *   today & p1 & #工作
 *   (overdue | today) & !@等待中
 *
 * 語法採運算子式的組合：& 且、| 或、! 非、() 分組，其餘一律視為關鍵字。
 * 解析成 AST 再求值，而不是邊掃邊判斷——AST 讓「這個查詢是什麼意思」
 * 可以被單獨測試，也讓日後要顯示查詢的結構（例如語法高亮）不必重寫。
 *
 * 解析失敗回傳錯誤而不是丟例外，也不是靜靜地回傳「全部」：
 * 打錯字的查詢如果安靜地match 全部，使用者會以為自己的條件成立了。
 */

export type FilterNode =
  | { type: 'and'; left: FilterNode; right: FilterNode }
  | { type: 'or'; left: FilterNode; right: FilterNode }
  | { type: 'not'; operand: FilterNode }
  | { type: 'date'; value: 'today' | 'overdue' | 'upcoming' | 'nodate' }
  | { type: 'status'; value: 'done' | 'todo' }
  | { type: 'priority'; value: 1 | 2 | 3 | 4 }
  | { type: 'project'; name: string }
  | { type: 'label'; name: string }
  | { type: 'text'; value: string }

export type ParseResult =
  | { ok: true; node: FilterNode }
  | { ok: false; message: string }

export interface FilterContext {
  projects?: readonly NamedCollection[]
  tags?: readonly NamedCollection[]
  now?: Date
  /** 「即將到來」往前看幾天，與檢視保持一致。 */
  upcomingDays?: number
}

// ------------------------------------------------------------------ 詞法

type Token =
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  /** quoted 的詞一律當字面文字：引號的意思就是「照字面找」，
   *  否則使用者沒辦法搜尋「今天」這兩個字本身。 */
  | { kind: 'word'; value: string; quoted: boolean }

const OPERATORS: Record<string, Token> = {
  '&': { kind: 'and' },
  '|': { kind: 'or' },
  '!': { kind: 'not' },
  '(': { kind: 'lparen' },
  ')': { kind: 'rparen' },
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i] as string

    if (/\s/.test(ch)) {
      i++
      continue
    }

    const op = OPERATORS[ch]
    if (op) {
      tokens.push(op)
      i++
      continue
    }

    // 一個詞可以由「前綴 + 引號段 + 一般字元」拼成，
    // 這樣 #"下半年 OKR" 才會是一個完整的專案名而不是三個詞。
    let value = ''
    let quoted = false
    let j = i
    while (j < input.length) {
      const c = input[j] as string
      if (c === '"' || c === '「') {
        const closing = c === '"' ? '"' : '」'
        const end = input.indexOf(closing, j + 1)
        const stop = end === -1 ? input.length : end
        value += input.slice(j + 1, stop)
        quoted = true
        j = stop + 1
        continue
      }
      if (/\s/.test(c) || OPERATORS[c]) break
      value += c
      j++
    }
    tokens.push({ kind: 'word', value, quoted })
    i = j
  }
  return tokens
}

// ------------------------------------------------------------------ 語法

function wordToNode(word: string, quoted: boolean): FilterNode {
  if (word.startsWith('#') && word.length > 1) return { type: 'project', name: word.slice(1) }
  if (word.startsWith('@') && word.length > 1) return { type: 'label', name: word.slice(1) }

  // 加了引號就是要照字面找，不再套用保留字——否則搜尋「今天」這兩個字本身
  // 會變成不可能，因為它永遠被當成日期條件。
  if (quoted) return { type: 'text', value: word }

  const lower = normalizeForSearch(word)

  switch (lower) {
    case 'today':
    case '今天':
      return { type: 'date', value: 'today' }
    case 'overdue':
    case '逾期':
      return { type: 'date', value: 'overdue' }
    case 'upcoming':
    case '即將到來':
      return { type: 'date', value: 'upcoming' }
    case 'nodate':
    case '無日期':
      return { type: 'date', value: 'nodate' }
    case 'done':
    case '已完成':
      return { type: 'status', value: 'done' }
    case 'todo':
    case '未完成':
      return { type: 'status', value: 'todo' }
    default:
      break
  }

  const priority = /^p([1-4])$/.exec(lower)
  if (priority) return { type: 'priority', value: Number(priority[1]) as 1 | 2 | 3 | 4 }

  return { type: 'text', value: word }
}

/**
 * 遞迴下降解析。優先序由低到高：or → and → not → primary，
 * 也就是 `a & b | c` 會被讀成 `(a & b) | c`，與大多數語言一致。
 */
export function parseFilterQuery(input: string): ParseResult {
  const tokens = tokenize(input)
  if (tokens.length === 0) return { ok: false, message: '查詢是空的' }

  let pos = 0
  const peek = (): Token | undefined => tokens[pos]

  function parseOr(): FilterNode | string {
    let left = parseAnd()
    if (typeof left === 'string') return left
    while (peek()?.kind === 'or') {
      pos++
      const right = parseAnd()
      if (typeof right === 'string') return right
      left = { type: 'or', left, right }
    }
    return left
  }

  function parseAnd(): FilterNode | string {
    let left = parseNot()
    if (typeof left === 'string') return left
    // 相鄰的兩個詞視為 and（「today p1」等同「today & p1」），
    // 因為多數人打查詢時不會記得加 &
    while (peek() !== undefined && peek()?.kind !== 'or' && peek()?.kind !== 'rparen') {
      if (peek()?.kind === 'and') pos++
      if (peek() === undefined || peek()?.kind === 'rparen') {
        return '運算子後面缺少條件'
      }
      const right = parseNot()
      if (typeof right === 'string') return right
      left = { type: 'and', left, right }
    }
    return left
  }

  function parseNot(): FilterNode | string {
    if (peek()?.kind === 'not') {
      pos++
      const operand = parseNot()
      if (typeof operand === 'string') return operand
      return { type: 'not', operand }
    }
    return parsePrimary()
  }

  function parsePrimary(): FilterNode | string {
    const token = peek()
    if (token === undefined) return '條件不完整'
    if (token.kind === 'lparen') {
      pos++
      const inner = parseOr()
      if (typeof inner === 'string') return inner
      if (peek()?.kind !== 'rparen') return '少了一個右括號'
      pos++
      return inner
    }
    if (token.kind === 'word') {
      pos++
      return wordToNode(token.value, token.quoted)
    }
    return '這裡應該是一個條件，不是運算子'
  }

  const node = parseOr()
  if (typeof node === 'string') return { ok: false, message: node }
  if (pos < tokens.length) return { ok: false, message: '多出了無法解析的內容' }
  return { ok: true, node }
}

// ------------------------------------------------------------------ 求值

function matchesName(collection: readonly NamedCollection[], id: string | null, name: string): boolean {
  if (id === null) return false
  const target = collection.find((c) => c.id === id)
  return target !== undefined && normalizeForSearch(target.name) === normalizeForSearch(name)
}

export function evaluateFilter(
  node: FilterNode,
  task: StoredTask,
  context: FilterContext = {},
): boolean {
  const { projects = [], tags = [], now = new Date(), upcomingDays = 7 } = context
  const todayISO = todayOf(now)
  const evaluate = (n: FilterNode): boolean => evaluateFilter(n, task, context)

  switch (node.type) {
    case 'and':
      return evaluate(node.left) && evaluate(node.right)
    case 'or':
      return evaluate(node.left) || evaluate(node.right)
    case 'not':
      return !evaluate(node.operand)
    case 'status':
      return node.value === 'done' ? task.isCompleted : !task.isCompleted
    case 'priority':
      // 查詢語法用對外的 P 編號（p1 最高），與儲存值方向相反
      return task.priority === 4 - node.value
    case 'project':
      return matchesName(projects, task.projectId, node.name)
    case 'label':
      return task.tagIds.some((id) => matchesName(tags, id, node.name))
    case 'text':
      return matchesKeyword(task, node.value)
    case 'date':
      switch (node.value) {
        case 'nodate':
          return task.dueDate === null
        case 'overdue':
          return (
            !task.isCompleted && task.dueDate !== null && compareISODate(task.dueDate, todayISO) < 0
          )
        case 'today':
          return task.dueDate !== null && compareISODate(task.dueDate, todayISO) <= 0
        default: {
          if (task.dueDate === null) return false
          const days = Math.round(
            (Date.parse(`${task.dueDate}T00:00:00`) - Date.parse(`${todayISO}T00:00:00`)) /
              86_400_000,
          )
          return days < upcomingDays
        }
      }
  }
}

/** 一次解析、多次求值的方便包裝；解析失敗時回傳 null。 */
export function compileFilter(
  input: string,
  context: FilterContext = {},
): ((task: StoredTask) => boolean) | null {
  const parsed = parseFilterQuery(input)
  if (!parsed.ok) return null
  return (task: StoredTask) => evaluateFilter(parsed.node, task, context)
}

// ------------------------------------------------------------ 未知的名稱

export interface UnresolvedFilterNames {
  projects: string[]
  labels: string[]
}

/**
 * 語法正確、但 `#專案`／`@標籤` 指到一個現在不存在的名稱時，
 * 這段條件會永遠比對不到任何任務，而畫面只會顯示「符合 0 項」——
 * 使用者分不出這是「打錯字」還是「剛好沒有符合的任務」。
 * 把這兩種情況分開需要知道「這個名稱查無此項」，所以另外提供這個函式，
 * 而不是塞進 evaluateFilter：求值只回答 true/false，不該背著回傳診斷資訊。
 */
export function findUnresolvedNames(
  node: FilterNode,
  context: Pick<FilterContext, 'projects' | 'tags'> = {},
): UnresolvedFilterNames {
  const projects = context.projects ?? []
  const tags = context.tags ?? []
  const unresolvedProjects = new Set<string>()
  const unresolvedLabels = new Set<string>()

  const hasName = (collection: readonly NamedCollection[], name: string): boolean =>
    collection.some((c) => normalizeForSearch(c.name) === normalizeForSearch(name))

  function walk(n: FilterNode): void {
    switch (n.type) {
      case 'and':
      case 'or':
        walk(n.left)
        walk(n.right)
        return
      case 'not':
        walk(n.operand)
        return
      case 'project':
        if (!hasName(projects, n.name)) unresolvedProjects.add(n.name)
        return
      case 'label':
        if (!hasName(tags, n.name)) unresolvedLabels.add(n.name)
        return
      default:
        return
    }
  }

  walk(node)
  return { projects: [...unresolvedProjects], labels: [...unresolvedLabels] }
}

// ------------------------------------------------------------ 自動完成

export interface FilterSuggestion {
  kind: 'keyword' | 'project' | 'label'
  /** 顯示用的完整詞（含 #／@ 前綴）。 */
  label: string
  /** 接受建議時要插入查詢字串的文字，必要時已加上引號。 */
  insertText: string
  /** 關鍵字的簡短說明；專案／標籤建議沒有這欄。 */
  hint?: string
}

export interface FilterTokenRange {
  start: number
  end: number
}

/**
 * 一個詞的邊界跟 tokenize() 用同一套字元（運算子、空白、引號），
 * 這裡沒有重用 tokenize 是因為它要處理的是「游標所在、可能還沒打完」的半成品，
 * tokenize 面對的是打完、準備解析的完整字串——兩者對「不完整輸入」的容錯需求不同。
 */
const TOKEN_BOUNDARY = /[\s&|!()"「」]/

function tokenBounds(input: string, cursor: number): FilterTokenRange {
  let start = cursor
  while (start > 0 && !TOKEN_BOUNDARY.test(input[start - 1] as string)) start--
  let end = cursor
  while (end < input.length && !TOKEN_BOUNDARY.test(input[end] as string)) end++
  return { start, end }
}

/** 名稱含運算子或空白時要加引號，否則插入後的字串會被切成好幾個詞。 */
function quoteIfNeeded(name: string): string {
  return /[\s&|!()]/.test(name) ? `"${name}"` : name
}

const KEYWORD_SUGGESTIONS: readonly { token: string; hint: string }[] = [
  { token: 'today', hint: '今天或更早到期' },
  { token: 'overdue', hint: '已逾期' },
  { token: 'upcoming', hint: '未來幾天內到期' },
  { token: 'nodate', hint: '沒有到期日' },
  { token: 'done', hint: '已完成' },
  { token: 'todo', hint: '未完成' },
  { token: 'p1', hint: '優先度最高' },
  { token: 'p2', hint: '優先度較高' },
  { token: 'p3', hint: '優先度較低' },
  { token: 'p4', hint: '優先度最低' },
]

function matchCollections(
  collection: readonly NamedCollection[],
  needle: string,
  kind: 'project' | 'label',
): FilterSuggestion[] {
  const target = normalizeForSearch(needle)
  const prefix = kind === 'project' ? '#' : '@'
  return collection
    .filter((c) => target === '' || normalizeForSearch(c.name).includes(target))
    .map((c) => ({ kind, label: `${prefix}${c.name}`, insertText: `${prefix}${quoteIfNeeded(c.name)}` }))
}

/**
 * 游標目前打到一半的那個詞該建議什麼，以及接受建議時要替換掉字串的哪一段。
 *
 * `#`／`@` 開頭時只從既有的專案／標籤名稱裡找，因為語法本來就只認得到這些；
 * 其餘情況建議關鍵字——輸入框空著（游標落在一個空詞上）時回傳完整清單，
 * 讓使用者不必先看過下方的語法說明才知道有哪些詞可以用。
 */
export function suggestFilterTokens(
  input: string,
  cursor: number,
  context: Pick<FilterContext, 'projects' | 'tags'> = {},
): { range: FilterTokenRange; suggestions: FilterSuggestion[] } {
  const range = tokenBounds(input, cursor)
  const word = input.slice(range.start, cursor)

  if (word.startsWith('#')) {
    return { range, suggestions: matchCollections(context.projects ?? [], word.slice(1), 'project') }
  }
  if (word.startsWith('@')) {
    return { range, suggestions: matchCollections(context.tags ?? [], word.slice(1), 'label') }
  }

  const needle = normalizeForSearch(word)
  const suggestions = KEYWORD_SUGGESTIONS.filter(
    (k) => needle === '' || k.token.startsWith(needle),
  ).map((k) => ({ kind: 'keyword' as const, label: k.token, insertText: k.token, hint: k.hint }))
  return { range, suggestions }
}

// ------------------------------------------------------------------ 範本

/**
 * 建立篩選器時的起手式：涵蓋日期、優先度、狀態與組合語法各一個例子，
 * 讓從沒寫過查詢語法的人也能一鍵開始，而不必先讀完語法說明才敢動手打字。
 */
export const FILTER_QUERY_PRESETS: readonly { label: string; query: string }[] = [
  { label: '今天要做的', query: 'today' },
  { label: '已逾期', query: 'overdue' },
  { label: '今天的要事', query: 'today & p1' },
  { label: '即將到來', query: 'upcoming' },
  { label: '未完成且非低優先', query: 'todo & !p4' },
]
