import type { StoredTask } from '@/db/schema'
import { addDays, toISODate, today as todayOf } from './dates'

/**
 * 完成紀錄的統計。
 *
 * `completedAt` 從資料模型 v2 起就一直在存，卻從來沒有被讀過。
 * 這一層把它變成可以回頭看的東西：今天做完幾件、這週的走勢、連續幾天有進度。
 *
 * 純函式、零 IO，時間以參數注入——「連續天數」是最容易寫成
 * 「在我的機器上、在今天是對的」的計算。
 */

export interface DailyCount {
  /** YYYY-MM-DD */
  date: string
  count: number
}

export interface Stats {
  /** 由舊到新，長度等於 days，沒有完成紀錄的日子也會佔一格（count 為 0）。 */
  daily: DailyCount[]
  todayCount: number
  weekCount: number
  totalCompleted: number
  /** 到今天為止連續有完成紀錄的天數。今天還沒完成任何事時，昨天以前的連續仍然算數。 */
  currentStreak: number
  longestStreak: number
  /** 目前尚未完成的數量，讓「做了多少」旁邊有個對照。 */
  remaining: number
}

/**
 * 把 completedAt（毫秒時間戳）換成本地日期字串。
 *
 * 用本地日期而不是 UTC：使用者晚上十一點完成的事屬於「今天」，
 * 換算成 UTC 會變成明天，統計就會和使用者的體感差一天。
 */
function completedDate(task: StoredTask): string | null {
  if (!task.isCompleted || task.completedAt === null) return null
  return toISODate(new Date(task.completedAt))
}

export function completionsByDate(tasks: readonly StoredTask[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const date = completedDate(task)
    if (date === null) continue
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  return counts
}

/** 從 `from` 往回數連續有紀錄的天數。 */
function streakEndingAt(counts: Map<string, number>, from: string): number {
  let streak = 0
  let cursor = from
  while ((counts.get(cursor) ?? 0) > 0) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function computeStats(
  tasks: readonly StoredTask[],
  options: { days?: number; now?: Date } = {},
): Stats {
  const { days = 14, now = new Date() } = options
  const todayISO = todayOf(now)
  const counts = completionsByDate(tasks)

  const daily: DailyCount[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(todayISO, -i)
    daily.push({ date, count: counts.get(date) ?? 0 })
  }

  const weekCount = daily.slice(-7).reduce((sum, d) => sum + d.count, 0)

  // 今天還沒完成任何事時不該把連續歸零——一天才剛開始。
  // 這時改從昨天起算，跟多數習慣追蹤工具的行為一致。
  const currentStreak =
    (counts.get(todayISO) ?? 0) > 0
      ? streakEndingAt(counts, todayISO)
      : streakEndingAt(counts, addDays(todayISO, -1))

  let longestStreak = 0
  for (const date of counts.keys()) {
    // 只從「連續的最後一天」往回算，避免同一段連續被重複計算
    if ((counts.get(addDays(date, 1)) ?? 0) > 0) continue
    longestStreak = Math.max(longestStreak, streakEndingAt(counts, date))
  }

  return {
    daily,
    todayCount: counts.get(todayISO) ?? 0,
    weekCount,
    totalCompleted: tasks.filter((t) => t.isCompleted).length,
    currentStreak,
    longestStreak,
    remaining: tasks.filter((t) => !t.isCompleted).length,
  }
}
