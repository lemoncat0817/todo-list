import { describe, it, expect } from 'vitest'
import { DEFAULT_RECURRENCE, describeRecurrence, isRecurrence, nextOccurrence } from '@/domain/recurrence'
import type { Recurrence } from '@/db/schema'

const rule = (patch: Partial<Recurrence> = {}): Recurrence => ({ ...DEFAULT_RECURRENCE, ...patch })

describe('isRecurrence', () => {
  it('接受合法規則', () => {
    expect(isRecurrence(DEFAULT_RECURRENCE)).toBe(true)
    expect(isRecurrence(rule({ freq: 'weekly', byDay: ['MO', 'WE'] }))).toBe(true)
  })

  it.each([
    ['null', null],
    ['字串', 'daily'],
    ['未知 freq', { ...DEFAULT_RECURRENCE, freq: 'yearly' }],
    ['interval 為 0', { ...DEFAULT_RECURRENCE, interval: 0 }],
    ['interval 非整數', { ...DEFAULT_RECURRENCE, interval: 1.5 }],
    ['byDay 非陣列', { ...DEFAULT_RECURRENCE, byDay: 'MO' }],
    ['byDay 含未知代碼', { ...DEFAULT_RECURRENCE, byDay: ['XX'] }],
    ['byMonthDay 超出範圍', { ...DEFAULT_RECURRENCE, byMonthDay: 32 }],
    ['until 格式錯誤', { ...DEFAULT_RECURRENCE, until: '2026/01/01' }],
    ['count 為 0', { ...DEFAULT_RECURRENCE, count: 0 }],
  ])('拒絕 %s', (_label, bad) => {
    expect(isRecurrence(bad)).toBe(false)
  })
})

describe('每日重複', () => {
  it('interval=1 就是隔天', () => {
    expect(nextOccurrence(rule(), '2026-08-16')).toBe('2026-08-17')
  })
  it('interval=3 跳三天', () => {
    expect(nextOccurrence(rule({ interval: 3 }), '2026-08-16')).toBe('2026-08-19')
  })
  it('跨月', () => {
    expect(nextOccurrence(rule(), '2026-08-31')).toBe('2026-09-01')
  })
  it('跨年', () => {
    expect(nextOccurrence(rule(), '2026-12-31')).toBe('2027-01-01')
  })
  it('閏日', () => {
    expect(nextOccurrence(rule(), '2028-02-28')).toBe('2028-02-29')
  })
})

describe('每週重複', () => {
  it('byDay 為空時等同每 N 週的同一天', () => {
    expect(nextOccurrence(rule({ freq: 'weekly' }), '2026-08-16')).toBe('2026-08-23')
    expect(nextOccurrence(rule({ freq: 'weekly', interval: 2 }), '2026-08-16')).toBe('2026-08-30')
  })

  it('byDay 有值時先找本週稍後的指定日', () => {
    // 2026-08-17 是星期一，指定週一與週四 -> 下一次是週四 8/20
    expect(nextOccurrence(rule({ freq: 'weekly', byDay: ['MO', 'TH'] }), '2026-08-17')).toBe(
      '2026-08-20',
    )
  })

  it('本週已無指定日時跳到下一輪的第一個', () => {
    // 2026-08-20 是星期四，指定週一與週四 -> 下一次是下週一 8/24
    expect(nextOccurrence(rule({ freq: 'weekly', byDay: ['MO', 'TH'] }), '2026-08-20')).toBe(
      '2026-08-24',
    )
  })

  it('interval=2 時跳過一週', () => {
    // 星期四出發，指定週一，interval=2 -> 兩週後的週一
    expect(
      nextOccurrence(rule({ freq: 'weekly', byDay: ['MO'], interval: 2 }), '2026-08-20'),
    ).toBe('2026-08-31')
  })

  it('重複的 byDay 不會造成重複計算', () => {
    expect(
      nextOccurrence(rule({ freq: 'weekly', byDay: ['MO', 'MO', 'TH'] }), '2026-08-17'),
    ).toBe('2026-08-20')
  })
})

describe('每月重複', () => {
  it('沿用起始日', () => {
    expect(nextOccurrence(rule({ freq: 'monthly' }), '2026-08-16')).toBe('2026-09-16')
  })

  it('31 號遇到只有 30 天的月份會夾到月底', () => {
    expect(nextOccurrence(rule({ freq: 'monthly' }), '2026-03-31')).toBe('2026-04-30')
  })

  it('31 號遇到二月（非閏年）夾到 28', () => {
    expect(nextOccurrence(rule({ freq: 'monthly' }), '2026-01-31')).toBe('2026-02-28')
  })

  it('31 號遇到二月（閏年）夾到 29', () => {
    expect(nextOccurrence(rule({ freq: 'monthly' }), '2028-01-31')).toBe('2028-02-29')
  })

  it('byMonthDay 指定固定日', () => {
    expect(nextOccurrence(rule({ freq: 'monthly', byMonthDay: 1 }), '2026-08-16')).toBe(
      '2026-09-01',
    )
  })

  it('byMonthDay=31 在只有 30 天的月份夾到 30', () => {
    expect(nextOccurrence(rule({ freq: 'monthly', byMonthDay: 31 }), '2026-03-15')).toBe(
      '2026-04-30',
    )
  })

  it('interval=3 跳三個月', () => {
    expect(nextOccurrence(rule({ freq: 'monthly', interval: 3 }), '2026-08-16')).toBe('2026-11-16')
  })
})

describe('結束條件', () => {
  it('超過 until 就結束', () => {
    expect(nextOccurrence(rule({ until: '2026-08-20' }), '2026-08-19')).toBe('2026-08-20')
    expect(nextOccurrence(rule({ until: '2026-08-20' }), '2026-08-20')).toBeNull()
  })

  it('until 當天仍算在內', () => {
    expect(nextOccurrence(rule({ until: '2026-08-17' }), '2026-08-16')).toBe('2026-08-17')
  })

  it('count 用盡就結束', () => {
    expect(nextOccurrence(rule({ count: 3 }), '2026-08-16', 1)).toBe('2026-08-17')
    expect(nextOccurrence(rule({ count: 3 }), '2026-08-16', 2)).toBe('2026-08-17')
    expect(nextOccurrence(rule({ count: 3 }), '2026-08-16', 3)).toBeNull()
  })

  it('起始日格式錯誤時回傳 null 而不是拋錯', () => {
    expect(nextOccurrence(rule(), 'not-a-date')).toBeNull()
    expect(nextOccurrence(rule(), '2026-02-30')).toBeNull()
  })
})

describe('describeRecurrence', () => {
  it('每日', () => {
    expect(describeRecurrence(rule())).toBe('每天')
    expect(describeRecurrence(rule({ interval: 3 }))).toBe('每 3 天')
  })
  it('每週指定星期', () => {
    expect(describeRecurrence(rule({ freq: 'weekly', byDay: ['MO', 'TH'] }))).toBe(
      '每週的星期一、四',
    )
  })
  it('每月指定日期', () => {
    expect(describeRecurrence(rule({ freq: 'monthly', byMonthDay: 15 }))).toBe('每月 15 號')
  })
  it('附帶結束條件', () => {
    expect(describeRecurrence(rule({ count: 5 }))).toBe('每天，共 5 次')
    expect(describeRecurrence(rule({ until: '2026-12-31' }))).toBe('每天，至 2026-12-31')
  })
})
