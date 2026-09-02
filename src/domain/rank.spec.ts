import { describe, expect, it } from 'vitest'
import { between, compareRank, sortByRank, withJitter } from './rank'

describe('between', () => {
  it('兩端都是 null 時回傳一個中間值', () => {
    const r = between(null, null)
    expect(r.length).toBeGreaterThan(0)
  })

  it('回傳值嚴格排在 a 與 b 之間', () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      [null, 'V'],
      ['V', null],
      ['A', 'B'],
      ['A', 'Z'],
      ['A0', 'A1'],
      ['z', null],
    ]
    for (const [a, b] of cases) {
      const r = between(a, b)
      if (a !== null) expect(r > a).toBe(true)
      if (b !== null) expect(r < b).toBe(true)
    }
  })

  it('a 與 b 相鄰（差 1）時仍能找到中間值，不會回傳 a 或 b', () => {
    const r = between('A', 'B')
    expect(r).not.toBe('A')
    expect(r).not.toBe('B')
    expect(r > 'A' && r < 'B').toBe(true)
  })

  it('a >= b 時丟出錯誤', () => {
    expect(() => between('B', 'A')).toThrow(RangeError)
    expect(() => between('A', 'A')).toThrow(RangeError)
  })

  it('尾端補零視同同一個值，兩者之間沒有間隙可插', () => {
    expect(() => between('0', '00')).toThrow(RangeError)
    expect(() => between('A0', 'A')).toThrow(RangeError)
    expect(() => between('A', 'A0')).toThrow(RangeError)
  })

  it('b 是可表示的最小值（0）時，前面沒有空間，丟出錯誤而不是算出違反邊界的值', () => {
    expect(() => between(null, '0')).toThrow(RangeError)
    expect(() => between(null, '00')).toThrow(RangeError)
  })

  it('連續在同一位置插入 200 次仍保持嚴格遞增，不需要重新編號', () => {
    let prev: string | null = null
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const next = between(prev, null)
      expect(prev === null || next > prev).toBe(true)
      expect(seen.has(next)).toBe(false)
      seen.add(next)
      prev = next
    }
  })

  it('連續往同一個間隙插入 200 次（反覆二分）仍保持順序、不拋錯', () => {
    const lo: string | null = 'A'
    let hi: string | null = 'B'
    for (let i = 0; i < 200; i++) {
      const mid = between(lo, hi)
      expect(mid > (lo as string)).toBe(true)
      expect(mid < (hi as string)).toBe(true)
      hi = mid
    }
  })
})

describe('withJitter', () => {
  it('加上尾碼後仍然落在原本的界線內', () => {
    for (let i = 0; i < 50; i++) {
      const base = between('A', 'B')
      const jittered = withJitter(base)
      expect(jittered > 'A').toBe(true)
      expect(jittered < 'B').toBe(true)
      expect(jittered).not.toBe(base)
    }
  })

  it('兩台裝置對同一個間隙算出相同的 rank 時，加了 jitter 後大機率不再相同', () => {
    const base = between('A', 'B')
    const results = new Set(Array.from({ length: 20 }, () => withJitter(base)))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('compareRank / sortByRank', () => {
  it('rank 不同時依 rank 排序', () => {
    const items = [
      { id: '1', rank: 'C' },
      { id: '2', rank: 'A' },
      { id: '3', rank: 'B' },
    ]
    expect(sortByRank(items).map((i) => i.id)).toEqual(['2', '3', '1'])
  })

  it('rank 相同時用 id 當第二排序鍵，讓所有裝置得到一致結果', () => {
    const items = [
      { id: 'b', rank: 'A' },
      { id: 'a', rank: 'A' },
      { id: 'c', rank: 'A' },
    ]
    expect(sortByRank(items).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('不改動原陣列', () => {
    const items = [
      { id: '2', rank: 'B' },
      { id: '1', rank: 'A' },
    ]
    const original = [...items]
    sortByRank(items)
    expect(items).toEqual(original)
  })

  it('compareRank 對相同物件回傳 0', () => {
    const item = { id: 'x', rank: 'A' }
    expect(compareRank(item, item)).toBe(0)
  })
})
