import { describe, it, expect } from 'vitest'
import {
  addDays,
  addMonths,
  compareISODate,
  daysInMonth,
  daysUntil,
  describeDue,
  fromISODate,
  isOverdue,
  isValidISODate,
  isValidTime,
  toISODate,
  weekdayIndex,
} from '@/domain/dates'

describe('ISO 日期解析', () => {
  it('合法日期來回轉換一致', () => {
    expect(toISODate(new Date(2026, 7, 16))).toBe('2026-08-16')
    expect(fromISODate('2026-08-16')?.getDate()).toBe(16)
  })

  it.each(['2026-8-16', '26-08-16', '2026/08/16', '', 'today', '2026-08-16T00:00'])(
    '格式不符時回傳 null：%s',
    (bad) => {
      expect(fromISODate(bad)).toBeNull()
    },
  )

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
    '攔截解析得出但不存在的日期：%s',
    (bad) => {
      expect(fromISODate(bad)).toBeNull()
    },
  )

  it('閏年的 2/29 是合法的', () => {
    expect(fromISODate('2028-02-29')).not.toBeNull()
    expect(isValidISODate('2028-02-29')).toBe(true)
  })
})

describe('isValidTime', () => {
  it.each(['00:00', '09:30', '23:59'])('接受 %s', (t) => {
    expect(isValidTime(t)).toBe(true)
  })
  it.each(['24:00', '9:30', '23:60', '', '12', null, 930])('拒絕 %s', (t) => {
    expect(isValidTime(t)).toBe(false)
  })
})

describe('addDays', () => {
  it('跨月', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('可以往回算', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('閏年的 2/28 下一天是 2/29', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('非閏年的 2/28 下一天是 3/1', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('addMonths —— 目標月沒有該日時夾到月底', () => {
  it('1/31 加一個月變成 2/28（非閏年）', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })
  it('1/31 加一個月變成 2/29（閏年）', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
  it('3/31 加一個月變成 4/30', () => {
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
  it('一般情況照常', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
  })
  it('跨年', () => {
    expect(addMonths('2026-11-30', 2)).toBe('2027-01-30')
  })
  it('可以往回算', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })
})

describe('daysInMonth', () => {
  it('二月在閏年是 29 天', () => {
    expect(daysInMonth(2028, 1)).toBe(29)
  })
  it('二月在非閏年是 28 天', () => {
    expect(daysInMonth(2026, 1)).toBe(28)
  })
  it('世紀年不是閏年除非能被 400 整除', () => {
    expect(daysInMonth(1900, 1)).toBe(28)
    expect(daysInMonth(2000, 1)).toBe(29)
  })
})

describe('weekdayIndex', () => {
  it('2026-08-16 是星期日', () => {
    expect(weekdayIndex('2026-08-16')).toBe(0)
  })
  it('2026-08-17 是星期一', () => {
    expect(weekdayIndex('2026-08-17')).toBe(1)
  })
})

describe('compareISODate', () => {
  it('字典序即時序', () => {
    expect(compareISODate('2026-01-01', '2026-01-02')).toBe(-1)
    expect(compareISODate('2026-02-01', '2026-01-31')).toBe(1)
    expect(compareISODate('2026-01-01', '2026-01-01')).toBe(0)
  })
})

describe('逾期判斷', () => {
  const now = new Date(2026, 7, 16)

  it('昨天算逾期', () => {
    expect(isOverdue('2026-08-15', now)).toBe(true)
  })
  it('今天不算逾期', () => {
    expect(isOverdue('2026-08-16', now)).toBe(false)
  })
  it('明天不算逾期', () => {
    expect(isOverdue('2026-08-17', now)).toBe(false)
  })
  it('沒有到期日就不會逾期', () => {
    expect(isOverdue(null, now)).toBe(false)
  })
})

describe('daysUntil 與 describeDue', () => {
  const now = new Date(2026, 7, 16)

  it('今天是 0 天', () => {
    expect(daysUntil('2026-08-16', now)).toBe(0)
    expect(describeDue('2026-08-16', now)).toBe('今天')
  })
  it('明天是 1 天', () => {
    expect(describeDue('2026-08-17', now)).toBe('明天')
  })
  it('昨天', () => {
    expect(describeDue('2026-08-15', now)).toBe('昨天')
  })
  it('逾期多天', () => {
    expect(describeDue('2026-08-10', now)).toBe('逾期 6 天')
  })
  it('一週內用相對描述', () => {
    expect(describeDue('2026-08-20', now)).toBe('4 天後')
  })
  it('超過一週直接顯示日期', () => {
    expect(describeDue('2026-09-30', now)).toBe('2026-09-30')
  })
})
