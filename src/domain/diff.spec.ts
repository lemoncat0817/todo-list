import { describe, it, expect } from 'vitest'
import { diffAgainstFingerprint } from './diff'

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
