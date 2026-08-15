import { WEEKDAYS, type Recurrence, type Weekday } from '@/db/schema'
import { addDays, addMonths, compareISODate, fromISODate, isValidISODate, weekdayIndex } from './dates'

/**
 * 重複規則的展開。
 *
 * 設計原則：**完成時才展開下一次**，不預先產生無限筆資料。
 * 預先展開會讓「改一次規則」變成「回頭修改上百筆已產生的任務」，
 * 而且無界的重複規則根本無法預先展開。
 *
 * 不使用 rrule（實測 +13.18 kB gzip）。欄位命名已對齊 RFC 5545，
 * 日後若需要 .ics 互通，換掉這個模組即可，資料不需要遷移。
 */

export const DEFAULT_RECURRENCE: Recurrence = {
  freq: 'daily',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  until: null,
  count: null,
}

export function isRecurrence(value: unknown): value is Recurrence {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  if (r.freq !== 'daily' && r.freq !== 'weekly' && r.freq !== 'monthly') return false
  if (typeof r.interval !== 'number' || !Number.isInteger(r.interval) || r.interval < 1) return false
  if (!Array.isArray(r.byDay) || r.byDay.some((d) => !WEEKDAYS.includes(d as Weekday))) return false
  if (r.byMonthDay !== null && (typeof r.byMonthDay !== 'number' || r.byMonthDay < 1 || r.byMonthDay > 31)) {
    return false
  }
  if (r.until !== null && !isValidISODate(r.until)) return false
  if (r.count !== null && (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1)) {
    return false
  }
  return true
}

const WEEKDAY_TO_INDEX: Record<Weekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

/**
 * 從 `from` 之後算出下一個發生日。
 * 回傳 null 代表規則已結束（超過 until，或 count 已用盡）。
 *
 * @param occurrencesSoFar 已經發生過幾次，用來判斷 count 是否用盡。
 */
export function nextOccurrence(
  rule: Recurrence,
  from: string,
  occurrencesSoFar = 1,
): string | null {
  if (!isValidISODate(from)) return null
  if (rule.count !== null && occurrencesSoFar >= rule.count) return null

  const candidate = computeNext(rule, from)
  if (candidate === null) return null
  if (rule.until !== null && compareISODate(candidate, rule.until) > 0) return null
  return candidate
}

function computeNext(rule: Recurrence, from: string): string | null {
  switch (rule.freq) {
    case 'daily':
      return addDays(from, rule.interval)

    case 'weekly':
      return nextWeekly(rule, from)

    case 'monthly':
      return nextMonthly(rule, from)

    default:
      return null
  }
}

/**
 * 每週規則。
 * byDay 為空時沿用起始日的星期（等同「每 N 週的同一天」）。
 * byDay 有值時，先在本週內找下一個指定的星期；找不到就跳到 interval 週之後的第一個。
 */
function nextWeekly(rule: Recurrence, from: string): string {
  if (rule.byDay.length === 0) return addDays(from, 7 * rule.interval)

  const wanted = [...new Set(rule.byDay.map((d) => WEEKDAY_TO_INDEX[d]))].sort((a, b) => a - b)
  const current = weekdayIndex(from)

  const laterThisWeek = wanted.find((d) => d > current)
  if (laterThisWeek !== undefined) return addDays(from, laterThisWeek - current)

  // 跳到 interval 週之後那一週的第一個指定日
  const first = wanted[0] as number
  const daysToWeekStart = 7 - current // 移到下週日
  const extraWeeks = (rule.interval - 1) * 7
  return addDays(from, daysToWeekStart + extraWeeks + first)
}

/**
 * 每月規則。
 * byMonthDay 為 null 時沿用起始日；有值時固定為該日，
 * 若目標月沒有該日（例如 31 號遇到 2 月）則夾到當月最後一天。
 */
function nextMonthly(rule: Recurrence, from: string): string {
  const base = addMonths(from, rule.interval)
  if (rule.byMonthDay === null) return base

  const date = fromISODate(base)
  if (!date) return base
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(rule.byMonthDay, lastDay))
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 供畫面顯示的人話描述。 */
export function describeRecurrence(rule: Recurrence): string {
  const every = rule.interval === 1 ? '每' : `每 ${rule.interval} `
  let base: string
  switch (rule.freq) {
    case 'daily':
      base = `${every}天`
      break
    case 'weekly':
      base =
        rule.byDay.length > 0
          ? `${every}週的星期${rule.byDay.map((d) => WEEKDAY_LABEL[d]).join('、')}`
          : `${every}週`
      break
    case 'monthly':
      base = rule.byMonthDay !== null ? `${every}月 ${rule.byMonthDay} 號` : `${every}月`
      break
  }
  if (rule.count !== null) return `${base}，共 ${rule.count} 次`
  if (rule.until !== null) return `${base}，至 ${rule.until}`
  return base
}

const WEEKDAY_LABEL: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
}
