import { describe, it, expect } from 'vitest'
import { parseMentions, suggestMentions, splitMentionSegments } from './mentions'

const MEMBERS = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
  { userId: 'u3', displayName: '王小明' },
]

describe('parseMentions', () => {
  it('比對到成員時回傳 user id', () => {
    expect(parseMentions('@Alice 麻煩看一下', MEMBERS)).toEqual(['u1'])
  })

  it('可以同時提及多人，結果去重', () => {
    expect(parseMentions('@Alice @Bob @Alice 一起討論', MEMBERS)).toEqual(['u1', 'u2'])
  })

  it('全形／半形、大小寫不同也比對得到', () => {
    expect(parseMentions('@ａｌｉｃｅ', MEMBERS)).toEqual(['u1'])
    expect(parseMentions('@ALICE', MEMBERS)).toEqual(['u1'])
  })

  it('比對不到任何成員時回傳空陣列', () => {
    expect(parseMentions('@不存在的人 你好', MEMBERS)).toEqual([])
  })

  it('沒有 @ 時回傳空陣列', () => {
    expect(parseMentions('沒有提到任何人', MEMBERS)).toEqual([])
  })

  it('中文名稱（沒有空白分隔）也比對得到', () => {
    expect(parseMentions('@王小明 你來看一下', MEMBERS)).toEqual(['u3'])
  })
})

describe('suggestMentions', () => {
  it('游標在 @ 詞元中間時回傳範圍與建議清單', () => {
    const text = '嗨 @al'
    const result = suggestMentions(text, text.length, MEMBERS)
    expect(result?.range).toEqual({ start: 2, end: text.length })
    expect(result?.suggestions.map((m) => m.userId)).toEqual(['u1'])
  })

  it('游標不在任何 @ 詞元裡時回傳 null', () => {
    expect(suggestMentions('沒有 at 符號', 4, MEMBERS)).toBeNull()
  })

  it('@ 跟游標之間有空白時，代表詞元已結束，回傳 null', () => {
    expect(suggestMentions('@Alice 麻煩', 8, MEMBERS)).toBeNull()
  })

  it('@ 後面還沒打字時，建議清單是全部成員', () => {
    const result = suggestMentions('@', 1, MEMBERS)
    expect(result?.suggestions).toHaveLength(3)
  })
})

describe('splitMentionSegments', () => {
  it('把提及切成獨立片段，前後文字保持原樣', () => {
    const segments = splitMentionSegments('嗨 @Alice 麻煩看一下', MEMBERS)
    expect(segments).toEqual([
      { text: '嗨 ', member: null },
      { text: '@Alice', member: { userId: 'u1', displayName: 'Alice' } },
      { text: ' 麻煩看一下', member: null },
    ])
  })

  it('比對不到成員的 @ 當純文字，不切段', () => {
    const segments = splitMentionSegments('信箱是 a@b.com', MEMBERS)
    expect(segments).toEqual([{ text: '信箱是 a@b.com', member: null }])
  })

  it('沒有 @ 時整段都是純文字', () => {
    expect(splitMentionSegments('普通留言', MEMBERS)).toEqual([{ text: '普通留言', member: null }])
  })

  it('可以同時有多個提及', () => {
    const segments = splitMentionSegments('@Alice @Bob 一起看', MEMBERS)
    expect(segments.map((s) => s.text)).toEqual(['@Alice', ' ', '@Bob', ' 一起看'])
  })
})
