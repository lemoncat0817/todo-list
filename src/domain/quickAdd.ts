import type { Priority, Recurrence, Weekday } from '@/db/schema'
import { addDays, daysInMonth, isValidISODate, today as todayOf, weekdayIndex } from './dates'
import { findByNormalizedName } from './filtering'
import type { NamedCollection } from './views'

/**
 * 快速新增的自然語言解析。
 *
 * 這是把「記下一件事」從六步壓成一行的地方：
 *   明天下午3點 交報告 p1 #工作 @公司
 * 之前要設一個到期日得走「新增 → hover → 開詳情 → 選日期 → 存檔」。
 *
 * 設計上的三個決定：
 *
 * 1. **純函式、零 IO**。專案與標籤以參數傳入，時間以 now 傳入。
 *    自然語言解析最容易寫出「在我的機器上是對的」的測試，把時間變成參數
 *    才能真的驗證跨年、跨月、週末這些邊界。
 *
 * 2. **解析失敗一律退回原文**。使用者打的字永遠是任務名稱的下限——
 *    寧可少解析一個日期，也不能讓任務變成空白或名字被吃掉。
 *
 * 3. **回傳 tokens 讓畫面可以預覽**。系統理解成什麼必須在送出前就看得到，
 *    否則使用者是在猜；猜錯的代價是事後再開一次詳情，等於白做。
 */

/** 對使用者顯示的優先度用 P1 最高的編號，內部維持 0–3（3 最高）。 */
const PRIORITY_FROM_P: Record<string, Priority> = { '1': 3, '2': 2, '3': 1, '4': 0 }

const WEEKDAY_CHAR_TO_INDEX: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
}

const INDEX_TO_WEEKDAY: readonly Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export type QuickAddKind = 'date' | 'time' | 'priority' | 'project' | 'label' | 'recurrence'

export interface QuickAddToken {
  kind: QuickAddKind
  /** 原文中被吃掉的片段，供「這段被解析成什麼」的對照 */
  text: string
  /** 給使用者看的解讀結果 */
  label: string
}

export interface QuickAddFields {
  dueDate: string | null
  dueTime: string | null
  priority: Priority
  projectId: string | null
  tagIds: string[]
  recurrence: Recurrence | null
}

export interface QuickAddResult {
  taskName: string
  fields: QuickAddFields
  tokens: QuickAddToken[]
  /** 打了 #名稱 但沒有這個專案——由呼叫端決定要不要順手建立 */
  unknownProject: string | null
  unknownTags: string[]
}

export interface QuickAddContext {
  projects?: readonly NamedCollection[]
  tags?: readonly NamedCollection[]
  now?: Date
}

const EMPTY_FIELDS: QuickAddFields = {
  dueDate: null,
  dueTime: null,
  priority: 0,
  projectId: null,
  tagIds: [],
  recurrence: null,
}

interface Match {
  start: number
  end: number
}

/** 收集要從任務名稱裡挖掉的片段，最後一次性移除。 */
class Cuts {
  private ranges: Match[] = []

  add(start: number, end: number): void {
    this.ranges.push({ start, end })
  }

  /** 這個位置是否已經被別的規則吃掉了——避免「每週一」的「一」又被當成星期。 */
  taken(start: number, end: number): boolean {
    return this.ranges.some((r) => start < r.end && end > r.start)
  }

  apply(input: string): string {
    if (this.ranges.length === 0) return input.trim()
    const sorted = [...this.ranges].sort((a, b) => a.start - b.start)
    let out = ''
    let cursor = 0
    for (const r of sorted) {
      if (r.start > cursor) out += input.slice(cursor, r.start)
      cursor = Math.max(cursor, r.end)
    }
    out += input.slice(cursor)
    // 挖掉片段後常留下連續空白，收斂成單一空白再 trim
    return out.replace(/\s+/g, ' ').trim()
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 從今天起算，下一個落在該星期的日期（含今天）。 */
function nextWeekday(fromISO: string, targetIndex: number): string {
  const diff = (targetIndex - weekdayIndex(fromISO) + 7) % 7
  return addDays(fromISO, diff)
}

/** 下週的某一天：以週一為一週之始，先跳到下週一再位移。 */
function nextWeekWeekday(fromISO: string, targetIndex: number): string {
  const dow = weekdayIndex(fromISO)
  const daysToNextMonday = (8 - dow) % 7 || 7
  const monday = addDays(fromISO, daysToNextMonday)
  // 週日屬於該週的最後一天，而不是週一的前一天
  const offset = targetIndex === 0 ? 6 : targetIndex - 1
  return addDays(monday, offset)
}

/** M/D：預設今年，但已經過去的日期指向明年——沒有人會把待辦排在上個月。 */
function monthDayToISO(month: number, day: number, todayISO: string): string | null {
  if (month < 1 || month > 12) return null
  const year = Number(todayISO.slice(0, 4))
  if (day < 1 || day > daysInMonth(year, month - 1)) return null
  const candidate = `${year}-${pad(month)}-${pad(day)}`
  return candidate < todayISO ? `${year + 1}-${pad(month)}-${pad(day)}` : candidate
}

function meridiemHour(word: string, hour: number): number {
  if (word === '中午') return 12
  if (word === '下午' || word === '晚上' || word === '傍晚') return hour < 12 ? hour + 12 : hour
  // 上午 / 早上 / 凌晨：12 點在中文口語裡是 0 點
  return hour === 12 ? 0 : hour
}

/** 依序套用 patterns，第一個命中的就收下——規則之間刻意不互相疊加。 */
function runFirst(
  input: string,
  cuts: Cuts,
  patterns: readonly [RegExp, (m: RegExpExecArray) => { value: string; label: string } | null][],
): { value: string; label: string; text: string } | null {
  for (const [re, handler] of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(input)) !== null) {
      const start = m.index
      const end = m.index + m[0].length
      if (cuts.taken(start, end)) continue
      const result = handler(m)
      if (result === null) continue
      cuts.add(start, end)
      return { ...result, text: m[0] }
    }
  }
  return null
}

export function parseQuickAdd(raw: string, context: QuickAddContext = {}): QuickAddResult {
  const input = raw.trim()
  const { projects = [], tags = [], now = new Date() } = context
  const todayISO = todayOf(now)

  const fields: QuickAddFields = { ...EMPTY_FIELDS, tagIds: [] }
  const tokens: QuickAddToken[] = []
  const cuts = new Cuts()
  let unknownProject: string | null = null
  const unknownTags: string[] = []

  // --- 重複規則要最先解析：「每週一」的「一」不能被當成「週一」這個日期 ---
  const recurrenceMatch = matchRecurrence(input, cuts, todayISO)
  if (recurrenceMatch) {
    fields.recurrence = recurrenceMatch.rule
    // 重複一定要有到期日才會生效，沒指定日期時以第一次發生日補上
    fields.dueDate = recurrenceMatch.firstDue
    tokens.push({ kind: 'recurrence', text: recurrenceMatch.text, label: recurrenceMatch.label })
  }

  // --- 日期 ---
  const date = runFirst(input, cuts, [
    [/\d{4}-\d{2}-\d{2}/g, (m) => (isValidISODate(m[0]) ? { value: m[0], label: m[0] } : null)],
    [/今天|今日/g, () => ({ value: todayISO, label: `今天 ${todayISO}` })],
    [/明天|明日/g, () => ({ value: addDays(todayISO, 1), label: `明天 ${addDays(todayISO, 1)}` })],
    [/後天/g, () => ({ value: addDays(todayISO, 2), label: `後天 ${addDays(todayISO, 2)}` })],
    [
      /(下週|下周|下星期|下禮拜)\s*([一二三四五六日天])/g,
      (m) => {
        const index = WEEKDAY_CHAR_TO_INDEX[m[2] ?? '']
        if (index === undefined) return null
        const iso = nextWeekWeekday(todayISO, index)
        return { value: iso, label: `${m[0]} ${iso}` }
      },
    ],
    [
      /(這週|本週|這周|本周|週|周|星期|禮拜)\s*([一二三四五六日天])/g,
      (m) => {
        const index = WEEKDAY_CHAR_TO_INDEX[m[2] ?? '']
        if (index === undefined) return null
        const iso = nextWeekday(todayISO, index)
        return { value: iso, label: `${m[0]} ${iso}` }
      },
    ],
    [
      /(\d{1,3})\s*天後/g,
      (m) => {
        const days = Number(m[1])
        if (!Number.isFinite(days)) return null
        const iso = addDays(todayISO, days)
        return { value: iso, label: `${m[0]} ${iso}` }
      },
    ],
    [
      /(?:^|[\s(])(\d{1,2})\/(\d{1,2})(?=$|[\s)])/g,
      (m) => {
        const iso = monthDayToISO(Number(m[1]), Number(m[2]), todayISO)
        return iso === null ? null : { value: iso, label: iso }
      },
    ],
  ])
  if (date) {
    fields.dueDate = date.value
    tokens.push({ kind: 'date', text: date.text, label: `到期 ${date.label}` })
  }

  // --- 時間（需要搭配日期才有意義，沒有日期時預設今天）---
  const time = runFirst(input, cuts, [
    [
      // 「點半」要排在前面，否則 [:：點時] 會先吃掉「點」只留下一個「半」；
      // 分鐘一律可省略，「下午3點」與「下午3點30分」都要能完整吃掉
      /(上午|早上|凌晨|中午|下午|晚上|傍晚)\s*(\d{1,2})\s*(?:點半|[:：點時]\s*(\d{1,2})?\s*分?)?/g,
      (m) => {
        const hour = Number(m[2])
        if (hour > 23) return null
        const half = m[0].endsWith('點半')
        const minute = half ? 30 : Number(m[3] ?? 0)
        if (minute > 59) return null
        const h = meridiemHour(m[1] ?? '', hour)
        return { value: `${pad(h)}:${pad(minute)}`, label: `${pad(h)}:${pad(minute)}` }
      },
    ],
    [
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)/g,
      (m) => {
        let hour = Number(m[1])
        const minute = Number(m[2] ?? 0)
        if (hour > 12 || minute > 59) return null
        const isPM = (m[3] ?? '').toLowerCase() === 'pm'
        if (isPM && hour < 12) hour += 12
        if (!isPM && hour === 12) hour = 0
        return { value: `${pad(hour)}:${pad(minute)}`, label: `${pad(hour)}:${pad(minute)}` }
      },
    ],
    [
      /(?:^|\s)(\d{1,2}):(\d{2})(?=$|\s)/g,
      (m) => {
        const hour = Number(m[1])
        const minute = Number(m[2])
        if (hour > 23 || minute > 59) return null
        return { value: `${pad(hour)}:${pad(minute)}`, label: `${pad(hour)}:${pad(minute)}` }
      },
    ],
    [
      /(\d{1,2})\s*點(半)?/g,
      (m) => {
        const hour = Number(m[1])
        if (hour > 23) return null
        const minute = m[2] ? 30 : 0
        return { value: `${pad(hour)}:${pad(minute)}`, label: `${pad(hour)}:${pad(minute)}` }
      },
    ],
  ])
  if (time) {
    fields.dueTime = time.value
    // 沒有日期的時間沒有意義（與 normalizeTask 的規則一致），補上今天
    if (fields.dueDate === null) fields.dueDate = todayISO
    tokens.push({ kind: 'time', text: time.text, label: `時間 ${time.label}` })
  }

  // --- 優先度 ---
  const priority = runFirst(input, cuts, [
    [
      /(?:^|\s)[pP]([1-4])(?=$|\s)/g,
      (m) => {
        const value = PRIORITY_FROM_P[m[1] ?? '']
        return value === undefined ? null : { value: String(value), label: `P${m[1]}` }
      },
    ],
  ])
  if (priority) {
    fields.priority = Number(priority.value) as Priority
    tokens.push({ kind: 'priority', text: priority.text, label: priority.label })
  }

  // --- 專案（只允許一個：一件事只屬於一個大方向）---
  const projectRe = /#([^\s#@]+)/g
  let pm: RegExpExecArray | null
  while ((pm = projectRe.exec(input)) !== null) {
    if (cuts.taken(pm.index, pm.index + pm[0].length)) continue
    const name = pm[1] ?? ''
    const found = findByNormalizedName(projects, name)
    cuts.add(pm.index, pm.index + pm[0].length)
    if (found) {
      fields.projectId = found.id
      tokens.push({ kind: 'project', text: pm[0], label: `專案 ${found.name}` })
    } else {
      unknownProject = name
      tokens.push({ kind: 'project', text: pm[0], label: `新專案 ${name}` })
    }
    break
  }

  // --- 標籤（可以有多個：情境是可以疊加的）---
  const tagRe = /@([^\s#@]+)/g
  let tm: RegExpExecArray | null
  while ((tm = tagRe.exec(input)) !== null) {
    if (cuts.taken(tm.index, tm.index + tm[0].length)) continue
    const name = tm[1] ?? ''
    const found = findByNormalizedName(tags, name)
    cuts.add(tm.index, tm.index + tm[0].length)
    if (found) {
      if (!fields.tagIds.includes(found.id)) fields.tagIds.push(found.id)
      tokens.push({ kind: 'label', text: tm[0], label: `標籤 ${found.name}` })
    } else {
      if (!unknownTags.includes(name)) unknownTags.push(name)
      tokens.push({ kind: 'label', text: tm[0], label: `新標籤 ${name}` })
    }
  }

  const taskName = cuts.apply(input)

  // 全部被解析掉會留下一筆沒有名字的任務。使用者打的字永遠是名稱的下限，
  // 這種情況下整句話原封不動當名稱，不套用任何解析結果——
  // 否則「明天」會變成一筆名為空白、到期日在明天的鬼任務。
  if (taskName === '') {
    return {
      taskName: input,
      fields: { ...EMPTY_FIELDS, tagIds: [] },
      tokens: [],
      unknownProject: null,
      unknownTags: [],
    }
  }

  return { taskName, fields, tokens, unknownProject, unknownTags }
}

interface RecurrenceMatch {
  rule: Recurrence
  firstDue: string
  text: string
  label: string
}

function matchRecurrence(input: string, cuts: Cuts, todayISO: string): RecurrenceMatch | null {
  const base = { byDay: [] as Weekday[], byMonthDay: null, until: null, count: null }

  const weekly = /每\s*(\d+)?\s*(?:週|周|星期|禮拜)\s*([一二三四五六日天])?/.exec(input)
  if (weekly) {
    cuts.add(weekly.index, weekly.index + weekly[0].length)
    const interval = Number(weekly[1] ?? 1) || 1
    const dayChar = weekly[2]
    const index = dayChar === undefined ? undefined : WEEKDAY_CHAR_TO_INDEX[dayChar]
    const byDay = index === undefined ? [] : [INDEX_TO_WEEKDAY[index] as Weekday]
    const firstDue = index === undefined ? todayISO : nextWeekday(todayISO, index)
    return {
      rule: { ...base, freq: 'weekly', interval, byDay },
      firstDue,
      text: weekly[0],
      label: `重複 ${weekly[0]}`,
    }
  }

  const daily = /每\s*(\d+)?\s*[天日]/.exec(input)
  if (daily) {
    cuts.add(daily.index, daily.index + daily[0].length)
    return {
      rule: { ...base, freq: 'daily', interval: Number(daily[1] ?? 1) || 1 },
      firstDue: todayISO,
      text: daily[0],
      label: `重複 ${daily[0]}`,
    }
  }

  const monthly = /每\s*(\d+)?\s*(?:個)?月/.exec(input)
  if (monthly) {
    cuts.add(monthly.index, monthly.index + monthly[0].length)
    return {
      rule: { ...base, freq: 'monthly', interval: Number(monthly[1] ?? 1) || 1 },
      firstDue: todayISO,
      text: monthly[0],
      label: `重複 ${monthly[0]}`,
    }
  }

  return null
}
