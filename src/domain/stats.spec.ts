import { describe, it, expect } from 'vitest'
import { completionsByDate, computeStats } from './stats'
import { makeTask } from '@/test/helpers'
import type { StoredTask } from '@/db/schema'

const NOW = new Date(2030, 0, 15, 21, 0, 0) // 2030-01-15 21:00 本地時間

/** makeTask 會用「現在」蓋掉 completedAt，所以建立後再指定。 */
function completedOn(name: string, y: number, m: number, d: number, hour = 12): StoredTask {
  return { ...makeTask(name, true), completedAt: new Date(y, m - 1, d, hour).getTime() }
}

describe('completionsByDate', () => {
  it('用本地日期分桶——晚上十一點完成的事屬於今天，不是 UTC 的明天', () => {
    const late = completedOn('深夜完成的', 2030, 1, 15, 23)
    expect([...completionsByDate([late]).keys()]).toEqual(['2030-01-15'])
  })

  it('未完成與缺少 completedAt 的都不計入', () => {
    const tasks = [
      makeTask('還沒做', false),
      { ...makeTask('宣稱完成但沒時間', true), completedAt: null },
      completedOn('真的完成', 2030, 1, 15),
    ]
    expect(completionsByDate(tasks).get('2030-01-15')).toBe(1)
  })
})

describe('computeStats', () => {
  it('daily 補齊沒有紀錄的日子，長度固定', () => {
    const stats = computeStats([completedOn('a', 2030, 1, 15)], { days: 3, now: NOW })
    expect(stats.daily).toEqual([
      { date: '2030-01-13', count: 0 },
      { date: '2030-01-14', count: 0 },
      { date: '2030-01-15', count: 1 },
    ])
  })

  it('今天與本週的數量', () => {
    const tasks = [
      completedOn('今天一', 2030, 1, 15),
      completedOn('今天二', 2030, 1, 15),
      completedOn('三天前', 2030, 1, 12),
      completedOn('很久以前', 2029, 6, 1),
    ]
    const stats = computeStats(tasks, { now: NOW })
    expect(stats.todayCount).toBe(2)
    expect(stats.weekCount, '最近七天').toBe(3)
    expect(stats.totalCompleted).toBe(4)
  })

  it('連續天數：今天有紀錄時從今天起算', () => {
    const tasks = [
      completedOn('a', 2030, 1, 15),
      completedOn('b', 2030, 1, 14),
      completedOn('c', 2030, 1, 13),
    ]
    expect(computeStats(tasks, { now: NOW }).currentStreak).toBe(3)
  })

  it('今天還沒完成任何事時不歸零——一天才剛開始', () => {
    const tasks = [completedOn('a', 2030, 1, 14), completedOn('b', 2030, 1, 13)]
    expect(computeStats(tasks, { now: NOW }).currentStreak).toBe(2)
  })

  it('中間斷過就重新起算', () => {
    const tasks = [
      completedOn('a', 2030, 1, 15),
      // 1/14 沒有紀錄
      completedOn('b', 2030, 1, 13),
    ]
    expect(computeStats(tasks, { now: NOW }).currentStreak).toBe(1)
  })

  it('最長連續不會因為同一段被重複計算而灌水', () => {
    const tasks = [
      completedOn('a', 2029, 12, 1),
      completedOn('b', 2029, 12, 2),
      completedOn('c', 2029, 12, 3),
      completedOn('d', 2030, 1, 15),
    ]
    const stats = computeStats(tasks, { now: NOW })
    expect(stats.longestStreak).toBe(3)
  })

  it('完全沒有完成紀錄時一切為零，不會爆炸', () => {
    const stats = computeStats([makeTask('還沒做', false)], { now: NOW })
    expect(stats.totalCompleted).toBe(0)
    expect(stats.currentStreak).toBe(0)
    expect(stats.longestStreak).toBe(0)
    expect(stats.remaining).toBe(1)
  })
})
