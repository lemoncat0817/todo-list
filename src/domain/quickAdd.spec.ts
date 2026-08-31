import { describe, it, expect } from 'vitest'
import { parseQuickAdd } from './quickAdd'

/**
 * 時間一律以參數注入。自然語言解析最容易寫出「在我的機器上、在今天是對的」
 * 的測試，把 now 變成參數才驗證得了跨年、跨月、週末這些邊界。
 *
 * 2030-01-15 是星期二。
 */
const NOW = new Date(2030, 0, 15, 9, 0, 0)
const ctx = (extra: Parameters<typeof parseQuickAdd>[1] = {}) => ({ now: NOW, ...extra })

const projects = [{ id: 'p-work', name: '工作' }]
const tags = [
  { id: 't-office', name: '公司' },
  { id: 't-urgent', name: '緊急' },
]

describe('parseQuickAdd — 日期', () => {
  it.each([
    ['今天 買牛奶', '2030-01-15', '買牛奶'],
    ['明天交報告', '2030-01-16', '交報告'],
    ['後天 健身', '2030-01-17', '健身'],
    ['3天後 回信', '2030-01-18', '回信'],
    ['2030-03-01 繳稅', '2030-03-01', '繳稅'],
  ])('%s → %s', (input, dueDate, taskName) => {
    const r = parseQuickAdd(input, ctx())
    expect(r.fields.dueDate).toBe(dueDate)
    expect(r.taskName).toBe(taskName)
  })

  it('週X 指向本週或之後最近的那一天（含今天）', () => {
    // 今天是週二
    expect(parseQuickAdd('週二 開會', ctx()).fields.dueDate).toBe('2030-01-15')
    expect(parseQuickAdd('週五 開會', ctx()).fields.dueDate).toBe('2030-01-18')
    // 週一已經過了，指向下一個週一
    expect(parseQuickAdd('週一 開會', ctx()).fields.dueDate).toBe('2030-01-21')
  })

  it('下週X 以週一為一週之始，週日算該週的最後一天', () => {
    expect(parseQuickAdd('下週一 開會', ctx()).fields.dueDate).toBe('2030-01-21')
    expect(parseQuickAdd('下週五 開會', ctx()).fields.dueDate).toBe('2030-01-25')
    expect(parseQuickAdd('下週日 休息', ctx()).fields.dueDate).toBe('2030-01-27')
  })

  it('星期／禮拜／周 都通', () => {
    for (const word of ['星期五', '禮拜五', '周五', '週五']) {
      expect(parseQuickAdd(`${word} 開會`, ctx()).fields.dueDate, word).toBe('2030-01-18')
    }
  })

  it('M/D 已經過去時指向明年——沒有人把待辦排在上個月', () => {
    expect(parseQuickAdd('3/1 繳稅', ctx()).fields.dueDate).toBe('2030-03-01')
    expect(parseQuickAdd('1/2 回顧', ctx()).fields.dueDate).toBe('2031-01-02')
  })

  it('不合法的日期不解析，整段留在名稱裡', () => {
    const r = parseQuickAdd('13/45 亂打', ctx())
    expect(r.fields.dueDate).toBeNull()
    expect(r.taskName).toBe('13/45 亂打')
  })
})

describe('parseQuickAdd — 時間', () => {
  it.each([
    ['下午3點 開會', '15:00'],
    ['晚上8點半 吃飯', '20:30'],
    ['早上9點30分 晨會', '09:30'],
    ['中午12點 午餐', '12:00'],
    ['上午12點 凌晨的事', '00:00'],
    ['3pm 開會', '15:00'],
    ['9:05 晨會', '09:05'],
    ['7點 起床', '07:00'],
  ])('%s → %s', (input, dueTime) => {
    expect(parseQuickAdd(input, ctx()).fields.dueTime).toBe(dueTime)
  })

  it('只有時間沒有日期時補上今天——沒有日期的時間沒有意義', () => {
    const r = parseQuickAdd('下午3點 開會', ctx())
    expect(r.fields.dueDate).toBe('2030-01-15')
  })

  it('日期與時間可以同時出現', () => {
    const r = parseQuickAdd('明天下午3點 交報告', ctx())
    expect(r.fields.dueDate).toBe('2030-01-16')
    expect(r.fields.dueTime).toBe('15:00')
    expect(r.taskName).toBe('交報告')
  })
})

describe('parseQuickAdd — 優先度', () => {
  it('p1 是最高，對應內部的 3', () => {
    expect(parseQuickAdd('交報告 p1', ctx()).fields.priority).toBe(3)
    expect(parseQuickAdd('交報告 p2', ctx()).fields.priority).toBe(2)
    expect(parseQuickAdd('交報告 p3', ctx()).fields.priority).toBe(1)
    expect(parseQuickAdd('交報告 p4', ctx()).fields.priority).toBe(0)
  })

  it('大寫也通，但字中間的 p1 不算', () => {
    expect(parseQuickAdd('交報告 P1', ctx()).fields.priority).toBe(3)
    const r = parseQuickAdd('修 bug p1x', ctx())
    expect(r.fields.priority).toBe(0)
    expect(r.taskName).toBe('修 bug p1x')
  })

  it('p5 以上不解析', () => {
    expect(parseQuickAdd('交報告 p5', ctx()).fields.priority).toBe(0)
  })
})

describe('parseQuickAdd — 專案與標籤', () => {
  it('#專案 對應到既有專案', () => {
    const r = parseQuickAdd('交報告 #工作', ctx({ projects }))
    expect(r.fields.projectId).toBe('p-work')
    expect(r.taskName).toBe('交報告')
    expect(r.unknownProject).toBeNull()
  })

  it('沒有這個專案時回報名稱，讓呼叫端決定要不要建立', () => {
    const r = parseQuickAdd('交報告 #新專案', ctx({ projects }))
    expect(r.fields.projectId).toBeNull()
    expect(r.unknownProject).toBe('新專案')
    expect(r.taskName).toBe('交報告')
  })

  it('@標籤 可以有多個，專案只取第一個', () => {
    const r = parseQuickAdd('交報告 @公司 @緊急 #工作', ctx({ projects, tags }))
    expect(r.fields.tagIds).toEqual(['t-office', 't-urgent'])
    expect(r.fields.projectId).toBe('p-work')
  })

  it('名稱比對忽略大小寫與全形半形', () => {
    const r = parseQuickAdd('note #ＷＯＲＫ', ctx({ projects: [{ id: 'p1', name: 'work' }] }))
    expect(r.fields.projectId).toBe('p1')
  })
})

describe('parseQuickAdd — 重複', () => {
  it('每天／每週／每月', () => {
    expect(parseQuickAdd('每天 吃藥', ctx()).fields.recurrence).toMatchObject({
      freq: 'daily',
      interval: 1,
    })
    expect(parseQuickAdd('每週 週報', ctx()).fields.recurrence).toMatchObject({ freq: 'weekly' })
    expect(parseQuickAdd('每月 繳房租', ctx()).fields.recurrence).toMatchObject({ freq: 'monthly' })
  })

  it('每N天可指定間隔', () => {
    expect(parseQuickAdd('每3天 澆水', ctx()).fields.recurrence).toMatchObject({
      freq: 'daily',
      interval: 3,
    })
  })

  it('每週一：星期不會被誤判成日期，並自動帶出第一次發生日', () => {
    const r = parseQuickAdd('每週一 週會', ctx())
    expect(r.fields.recurrence).toMatchObject({ freq: 'weekly', byDay: ['MO'] })
    expect(r.fields.dueDate, '重複要有到期日才生效').toBe('2030-01-21')
    expect(r.taskName).toBe('週會')
  })

  it('重複一律補上到期日，否則規則不會生效', () => {
    expect(parseQuickAdd('每天 吃藥', ctx()).fields.dueDate).toBe('2030-01-15')
  })

  it('明確指定的日期優先於重複規則推算出來的第一次', () => {
    const r = parseQuickAdd('每天 吃藥 2030-02-01', ctx())
    expect(r.fields.dueDate).toBe('2030-02-01')
  })
})

describe('parseQuickAdd — 整體行為', () => {
  it('一行搞定所有欄位', () => {
    const r = parseQuickAdd('明天下午3點 交季報 p1 #工作 @公司', ctx({ projects, tags }))
    expect(r.taskName).toBe('交季報')
    expect(r.fields).toMatchObject({
      dueDate: '2030-01-16',
      dueTime: '15:00',
      priority: 3,
      projectId: 'p-work',
      tagIds: ['t-office'],
    })
  })

  it('沒有任何語法時原文就是任務名稱', () => {
    const r = parseQuickAdd('買牛奶', ctx())
    expect(r.taskName).toBe('買牛奶')
    expect(r.tokens).toEqual([])
    expect(r.fields.dueDate).toBeNull()
  })

  it('整句都被解析掉時退回原文，不產生沒有名字的任務', () => {
    const r = parseQuickAdd('明天', ctx())
    expect(r.taskName).toBe('明天')
    expect(r.fields.dueDate, '寧可少解析一個日期，也不能讓任務沒有名字').toBeNull()
    expect(r.tokens).toEqual([])
  })

  it('tokens 讓畫面能在送出前顯示「系統理解成什麼」', () => {
    const r = parseQuickAdd('明天 交報告 p1 #工作', ctx({ projects }))
    expect(r.tokens.map((t) => t.kind)).toEqual(['date', 'priority', 'project'])
    expect(r.tokens.map((t) => t.label)).toEqual(['到期 明天 2030-01-16', 'P1', '專案 工作'])
    expect(r.tokens.map((t) => t.text)).toEqual(['明天', ' p1', '#工作'])
  })

  it('挖掉片段後不留下多餘空白', () => {
    expect(parseQuickAdd('明天  交  報告  p1', ctx()).taskName).toBe('交 報告')
  })

  it('空字串與純空白不會爆炸', () => {
    expect(parseQuickAdd('', ctx()).taskName).toBe('')
    expect(parseQuickAdd('   ', ctx()).taskName).toBe('')
  })
})
