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
