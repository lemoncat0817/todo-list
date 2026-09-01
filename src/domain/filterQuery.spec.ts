import { describe, it, expect } from 'vitest'
import {
  compileFilter,
  evaluateFilter,
  findUnresolvedNames,
  parseFilterQuery,
  suggestFilterTokens,
} from './filterQuery'
import { makeTask } from '@/test/helpers'

const NOW = new Date(2030, 0, 15, 9, 0, 0) // 2030-01-15
const projects = [{ id: 'p-work', name: '工作' }]
const tags = [{ id: 't-wait', name: '等待中' }]
const ctx = { projects, tags, now: NOW }

const parse = (q: string) => {
  const r = parseFilterQuery(q)
  if (!r.ok) throw new Error(`預期解析成功，卻得到：${r.message}`)
  return r.node
}

describe('parseFilterQuery', () => {
  it('把單一條件解析成對應的節點', () => {
    expect(parse('today')).toEqual({ type: 'date', value: 'today' })
    expect(parse('p1')).toEqual({ type: 'priority', value: 1 })
    expect(parse('#工作')).toEqual({ type: 'project', name: '工作' })
    expect(parse('@等待中')).toEqual({ type: 'label', name: '等待中' })
    expect(parse('報告')).toEqual({ type: 'text', value: '報告' })
  })

  it('中文關鍵字與英文關鍵字等價', () => {
    expect(parse('逾期')).toEqual(parse('overdue'))
    expect(parse('已完成')).toEqual(parse('done'))
  })

  it('& 的優先序高於 |', () => {
    // a & b | c 應讀成 (a & b) | c
    expect(parse('today & p1 | done')).toEqual({
      type: 'or',
      left: {
        type: 'and',
        left: { type: 'date', value: 'today' },
        right: { type: 'priority', value: 1 },
      },
      right: { type: 'status', value: 'done' },
    })
  })

  it('括號可以改寫優先序', () => {
    expect(parse('today & (p1 | done)')).toMatchObject({
      type: 'and',
      right: { type: 'or' },
    })
  })

  it('相鄰的兩個條件視為 and——多數人打查詢時不會記得加 &', () => {
    expect(parse('today p1')).toEqual(parse('today & p1'))
  })

  it('引號讓含空白的名稱寫得出來，並強制照字面解讀', () => {
    expect(parse('#"下半年 OKR"')).toEqual({ type: 'project', name: '下半年 OKR' })
    expect(parse('"買 牛奶"')).toEqual({ type: 'text', value: '買 牛奶' })
    // 沒有這條規則，就永遠搜尋不到「今天」這兩個字本身
    expect(parse('"今天"')).toEqual({ type: 'text', value: '今天' })
  })

  it('語法錯誤回報訊息，不是靜靜地變成「全部」', () => {
    // 安靜地 match 全部會讓使用者以為自己的條件成立了
    for (const bad of ['', 'today &', '(today', '& today']) {
      const r = parseFilterQuery(bad)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0)
    }
  })
})

describe('evaluateFilter', () => {
  const overdue = makeTask('逾期的', false, { dueDate: '2030-01-01', priority: 3 })
  const todayTask = makeTask('今天的', false, { dueDate: '2030-01-15', projectId: 'p-work' })
  const soon = makeTask('三天後', false, { dueDate: '2030-01-18', tagIds: ['t-wait'] })
  const someday = makeTask('沒日期', false)
  const done = makeTask('做完了', true, { dueDate: '2030-01-10' })

  const match = (query: string, task = todayTask) => evaluateFilter(parse(query), task, ctx)

  it('today 包含逾期——逾期的事不會因為日期過了就不用做', () => {
    expect(match('today', overdue)).toBe(true)
    expect(match('today', todayTask)).toBe(true)
    expect(match('today', soon)).toBe(false)
  })

  it('overdue 只算未完成的', () => {
    expect(match('overdue', overdue)).toBe(true)
    expect(match('overdue', done)).toBe(false)
  })

  it('upcoming 涵蓋未來七天', () => {
    expect(match('upcoming', soon)).toBe(true)
    expect(match('upcoming', makeTask('很久以後', false, { dueDate: '2030-06-01' }))).toBe(false)
  })

  it('nodate 找出沒有到期日的', () => {
    expect(match('nodate', someday)).toBe(true)
    expect(match('nodate', todayTask)).toBe(false)
  })

  it('p1 對應儲存值 3（顯示與儲存的編號方向相反）', () => {
    expect(match('p1', overdue)).toBe(true)
    expect(match('p4', someday)).toBe(true)
    expect(match('p1', someday)).toBe(false)
  })

  it('#專案 與 @標籤 依名稱比對，忽略大小寫與全形半形', () => {
    expect(match('#工作', todayTask)).toBe(true)
    expect(match('#不存在', todayTask)).toBe(false)
    expect(match('@等待中', soon)).toBe(true)
  })

  it('自由文字沿用既有的關鍵字比對', () => {
    expect(match('今天的', todayTask)).toBe(true)
    expect(match('不存在的字', todayTask)).toBe(false)
    // 「今天」是保留字；要找這兩個字本身得加引號（someday 名為「沒日期」，
    // 不含這兩個字，但它的到期日是 null 所以保留字版本也不會命中）
    expect(match('"今天"', someday)).toBe(false)
    expect(match('"今天"', makeTask('今天要做的', false))).toBe(true)
  })

  it('& | ! 組合出實際會用到的查詢', () => {
    expect(match('today & #工作', todayTask)).toBe(true)
    expect(match('today & #別的', todayTask)).toBe(false)
    expect(match('(overdue | today) & !@等待中', overdue)).toBe(true)
    expect(match('!done', done)).toBe(false)
  })
})

describe('compileFilter', () => {
  it('解析失敗時回傳 null，讓呼叫端能區分「沒有結果」與「查詢寫錯」', () => {
    expect(compileFilter('(today', ctx)).toBeNull()
  })

  it('成功時回傳可重複使用的述詞', () => {
    const predicate = compileFilter('today & p1', ctx)
    expect(predicate).not.toBeNull()
    expect(predicate?.(makeTask('a', false, { dueDate: '2030-01-15', priority: 3 }))).toBe(true)
    expect(predicate?.(makeTask('b', false, { dueDate: '2030-01-15', priority: 0 }))).toBe(false)
  })
})

describe('findUnresolvedNames', () => {
  it('語法正確但名稱查無此項時回報，讓畫面能區分「打錯字」與「剛好沒有符合的任務」', () => {
    expect(findUnresolvedNames(parse('#不存在'), ctx)).toEqual({ projects: ['不存在'], labels: [] })
    expect(findUnresolvedNames(parse('@也不存在'), ctx)).toEqual({ projects: [], labels: ['也不存在'] })
  })

  it('名稱存在時不回報任何東西', () => {
    expect(findUnresolvedNames(parse('#工作 & @等待中'), ctx)).toEqual({ projects: [], labels: [] })
  })

  it('忽略大小寫與全形半形，跟 evaluateFilter 用同一套比對規則', () => {
    expect(findUnresolvedNames(parse('#Ｗｏｒｋ'), { projects: [{ id: 'p', name: 'work' }] })).toEqual({
      projects: [],
      labels: [],
    })
  })

  it('會走進 and／or／not 底下找，不是只看最外層節點', () => {
    expect(findUnresolvedNames(parse('today & (#不存在 | !@也不存在)'), ctx)).toEqual({
      projects: ['不存在'],
      labels: ['也不存在'],
    })
  })

  it('同一個名稱出現多次只回報一次', () => {
    expect(findUnresolvedNames(parse('#不存在 | #不存在'), ctx)).toEqual({
      projects: ['不存在'],
      labels: [],
    })
  })
})

describe('suggestFilterTokens', () => {
  it('空字串時列出完整的關鍵字清單，不用先看過語法說明才知道有哪些詞', () => {
    const { range, suggestions } = suggestFilterTokens('', 0)
    expect(range).toEqual({ start: 0, end: 0 })
    expect(suggestions.map((s) => s.label)).toContain('today')
    expect(suggestions.map((s) => s.label)).toContain('p1')
  })

  it('依游標所在的詞做前綴篩選', () => {
    const { suggestions } = suggestFilterTokens('ov', 2)
    expect(suggestions.map((s) => s.label)).toEqual(['overdue'])
  })

  it('# 開頭只從既有專案找，不會混進標籤或關鍵字', () => {
    const { suggestions } = suggestFilterTokens('#工', 2, ctx)
    expect(suggestions).toEqual([{ kind: 'project', label: '#工作', insertText: '#工作' }])
  })

  it('@ 開頭只從既有標籤找', () => {
    const { suggestions } = suggestFilterTokens('@', 1, ctx)
    expect(suggestions).toEqual([{ kind: 'label', label: '@等待中', insertText: '@等待中' }])
  })

  it('名稱含空白時，插入用的文字會自動加上引號', () => {
    const withSpace = { projects: [{ id: 'p', name: '下半年 OKR' }], tags: [] }
    const { suggestions } = suggestFilterTokens('#', 1, withSpace)
    expect(suggestions).toEqual([
      { kind: 'project', label: '#下半年 OKR', insertText: '#"下半年 OKR"' },
    ])
  })

  it('建議的範圍只框住游標所在的那個詞，前後已經打完的詞不受影響', () => {
    const { range } = suggestFilterTokens('today & ov', 10)
    expect(range).toEqual({ start: 8, end: 10 })
  })

  it('游標停在字中間時，範圍會延伸到整個詞的結尾，接受建議會整詞替換', () => {
    const { range } = suggestFilterTokens('overdue', 2)
    expect(range).toEqual({ start: 0, end: 7 })
  })
})
