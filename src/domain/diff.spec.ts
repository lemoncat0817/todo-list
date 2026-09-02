import { describe, it, expect } from 'vitest'
import { diffAgainstFingerprint, diffFields } from './diff'

interface Row {
  id: string
  value: string
}

describe('diffAgainstFingerprint', () => {
  it('第一次跑（空指紋）時全部視為新增', () => {
    const rows: Row[] = [{ id: 'a', value: '1' }, { id: 'b', value: '2' }]
    const result = diffAgainstFingerprint(rows, new Map())
    expect(result.upserts.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(result.deletes).toEqual([])
  })

  it('內容沒變的列不出現在 upserts', () => {
    const rows: Row[] = [{ id: 'a', value: '1' }]
    const fingerprint = new Map([['a', JSON.stringify(rows[0])]])
    const result = diffAgainstFingerprint(rows, fingerprint)
    expect(result.upserts).toEqual([])
  })

  it('內容變了的列出現在 upserts', () => {
    const before: Row = { id: 'a', value: '1' }
    const after: Row = { id: 'a', value: '2' }
    const fingerprint = new Map([['a', JSON.stringify(before)]])
    const result = diffAgainstFingerprint([after], fingerprint)
    expect(result.upserts).toEqual([after])
  })

  it('指紋裡有、這次不在列表裡的 id 視為刪除', () => {
    const fingerprint = new Map([['a', '{}'], ['b', '{}']])
    const result = diffAgainstFingerprint([], fingerprint)
    expect(result.deletes.sort()).toEqual(['a', 'b'])
  })

  it('復原把舊物件放回去也算變更——只比對序列化內容，不是只看某個時間戳欄位', () => {
    const older = { id: 'a', value: 'old', updatedAt: 1 }
    const newer = { id: 'a', value: 'new', updatedAt: 2 }
    const fingerprint = new Map([['a', JSON.stringify(newer)]])
    const result = diffAgainstFingerprint([older], fingerprint)
    expect(result.upserts).toEqual([older])
  })

  it('nextFingerprint 反映這次算完之後的狀態，可以直接存起來供下次比對', () => {
    const rows: Row[] = [{ id: 'a', value: '1' }]
    const result = diffAgainstFingerprint(rows, new Map())
    expect(result.nextFingerprint.get('a')).toBe(JSON.stringify(rows[0]))
    expect(result.nextFingerprint.size).toBe(1)
  })
})

describe('diffFields', () => {
  it('before 是 null（全新的列）時整包 after 都算數', () => {
    const after = { a: 1, b: 'x' }
    expect(diffFields(null, after)).toEqual(after)
  })

  it('只回傳真的變了的欄位，沒變的欄位不出現在補丁裡', () => {
    const before = { name: '舊名字', color: '#000', order: 1 }
    const after = { name: '新名字', color: '#000', order: 1 }
    expect(diffFields(before, after)).toEqual({ name: '新名字' })
  })

  it('所有欄位都沒變時回傳空物件', () => {
    const row = { a: 1, b: 2 }
    expect(diffFields(row, { ...row })).toEqual({})
  })

  it('巢狀欄位（陣列／物件）用內容比較，不是參照比較', () => {
    const before = { tagIds: ['a', 'b'], recurrence: { freq: 'daily' } }
    // 內容相同、但是全新的陣列／物件參照——不該被當成變動
    expect(diffFields(before, { tagIds: ['a', 'b'], recurrence: { freq: 'daily' } })).toEqual({})
    // 內容真的不同才算數
    expect(diffFields(before, { tagIds: ['a', 'c'], recurrence: { freq: 'daily' } })).toEqual({
      tagIds: ['a', 'c'],
    })
  })

  it('多個欄位同時變動時全部一起回傳', () => {
    const before = { a: 1, b: 2, c: 3 }
    const after = { a: 10, b: 2, c: 30 }
    expect(diffFields(before, after)).toEqual({ a: 10, c: 30 })
  })

  it('欄位值從有變成 null 也算變動', () => {
    const before = { dueDate: '2026-01-01' as string | null }
    expect(diffFields(before, { dueDate: null })).toEqual({ dueDate: null })
  })
})
