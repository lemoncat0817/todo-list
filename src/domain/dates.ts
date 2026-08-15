/**
 * 日期工具。
 *
 * 全程以「本地日期字串（YYYY-MM-DD）」為單位運算，不碰時區偏移。
 * 這是刻意的取捨：本專案的任務是單機、以使用者當地日曆為準的，
 * 引入時區只會製造「明明寫今天卻顯示昨天」這類問題。
 *
 * 沒有採用 date-fns（實測 +5.39 kB gzip）或 Temporal polyfill（+19.06 kB）：
 * 這裡需要的運算就是加減天數與月份，用原生 Date 加上嚴格的邊界測試即可。
 */

/** 把 Date 轉成本地時區的 YYYY-MM-DD。 */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 解析 YYYY-MM-DD 為本地時間的 Date（當日 00:00）。格式錯誤回傳 null。 */
export function fromISODate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  // 攔截 2026-02-31 這類「解析得出但不存在」的日期
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

export function isValidISODate(value: unknown): value is string {
  return typeof value === 'string' && fromISODate(value) !== null
}

/** HH:mm，24 小時制。 */
export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function today(now: Date = new Date()): string {
  return toISODate(now)
}

export function addDays(isoDate: string, days: number): string {
  const date = fromISODate(isoDate)
  if (!date) throw new RangeError(`不是合法的日期字串：${isoDate}`)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

/**
 * 加月份，並處理「目標月沒有這一天」的情況。
 *
 * 1/31 加一個月在不同系統有不同結果；原生 Date 會溢位成 3/3。
 * 這裡改成夾到當月最後一天（1/31 → 2/28 或 2/29），
 * 這是行事曆軟體的通行作法，也比溢位符合直覺。
 */
export function addMonths(isoDate: string, months: number): string {
  const date = fromISODate(isoDate)
  if (!date) throw new RangeError(`不是合法的日期字串：${isoDate}`)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  const lastDay = daysInMonth(date.getFullYear(), date.getMonth())
  date.setDate(Math.min(day, lastDay))
  return toISODate(date)
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** 0=週日 … 6=週六，與 Date.getDay 一致。 */
export function weekdayIndex(isoDate: string): number {
  const date = fromISODate(isoDate)
  if (!date) throw new RangeError(`不是合法的日期字串：${isoDate}`)
  return date.getDay()
}

export function compareISODate(a: string, b: string): number {
  // YYYY-MM-DD 是字典序即時序，不需要轉成 Date
  return a < b ? -1 : a > b ? 1 : 0
}

export function isOverdue(dueDate: string | null, now: Date = new Date()): boolean {
  if (dueDate === null) return false
  return compareISODate(dueDate, today(now)) < 0
}

export function daysUntil(dueDate: string, now: Date = new Date()): number {
  const from = fromISODate(today(now))
  const to = fromISODate(dueDate)
  if (!from || !to) return Number.NaN
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** 供畫面顯示的相對描述。 */
export function describeDue(dueDate: string, now: Date = new Date()): string {
  const diff = daysUntil(dueDate, now)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff < 0) return `逾期 ${Math.abs(diff)} 天`
  if (diff <= 7) return `${diff} 天後`
  return dueDate
}
