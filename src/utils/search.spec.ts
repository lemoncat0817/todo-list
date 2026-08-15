import { describe, it, expect } from 'vitest'
import { normalizeForSearch, matchesKeyword } from '@/utils/search'

describe('normalizeForSearch', () => {
  it('轉為小寫', () => {
    expect(normalizeForSearch('Buy Milk')).toBe('buy milk')
  })

  it('全形英數收斂為半形', () => {
    expect(normalizeForSearch('ＢＵＹ１２３')).toBe('buy123')
  })

  it('中文不受影響', () => {
    expect(normalizeForSearch('買牛奶')).toBe('買牛奶')
  })

  it('組合字正規化為標準形式', () => {
    // e + 重音符號 的組合寫法，與單一字元的 é 應正規化為同一結果
    expect(normalizeForSearch('café')).toBe(normalizeForSearch('café'))
  })
})

describe('matchesKeyword（稽核 P4）', () => {
  it('大小寫不敏感 —— 這正是 P4 的缺陷', () => {
    expect(matchesKeyword('Buy Milk', 'buy')).toBe(true)
    expect(matchesKeyword('buy milk', 'BUY')).toBe(true)
    expect(matchesKeyword('BUY MILK', 'Milk')).toBe(true)
  })

  it('空關鍵字視為全部命中', () => {
    expect(matchesKeyword('任何內容', '')).toBe(true)
  })

  it('不相關的關鍵字不命中', () => {
    expect(matchesKeyword('買牛奶', '寫程式')).toBe(false)
  })

  it('中文子字串命中', () => {
    expect(matchesKeyword('去超市買牛奶', '牛奶')).toBe(true)
  })

  it('全形關鍵字可命中半形內容，反之亦然', () => {
    expect(matchesKeyword('buy milk', 'ＢＵＹ')).toBe(true)
    expect(matchesKeyword('ＢＵＹ ＭＩＬＫ', 'buy')).toBe(true)
  })
})
