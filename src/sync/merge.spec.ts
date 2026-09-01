import { describe, it, expect } from 'vitest'
import { mergeByUpdatedAt } from './merge'

interface Row {
  id: string
  name: string
  updatedAt: number
}

const row = (id: string, name: string, updatedAt: number): Row => ({ id, name, updatedAt })

describe('mergeByUpdatedAt', () => {
  it('遠端獨有的列直接併入，並算進 remoteWon', () => {
    const result = mergeByUpdatedAt([row('a', '本地', 10)], [row('b', '遠端新的', 20)])
    expect(result.merged.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(result.remoteWon).toEqual([row('b', '遠端新的', 20)])
  })

  it('同一筆遠端較新時，遠端贏', () => {
    const result = mergeByUpdatedAt([row('a', '舊', 10)], [row('a', '新', 20)])
    expect(result.merged).toEqual([row('a', '新', 20)])
    expect(result.remoteWon).toEqual([row('a', '新', 20)])
  })

  it('同一筆本地較新時，本地留著——剛做的修改不該被幾秒前的舊資料蓋掉', () => {
    const result = mergeByUpdatedAt([row('a', '剛改的', 20)], [row('a', '比較舊', 10)])
    expect(result.merged).toEqual([row('a', '剛改的', 20)])
    expect(result.remoteWon).toEqual([])
  })

  it('updatedAt 相等時維持本地版本，不當作變更——避免每次同步都判定為變動', () => {
    const result = mergeByUpdatedAt([row('a', '本地', 10)], [row('a', '遠端', 10)])
    expect(result.merged).toEqual([row('a', '本地', 10)])
    expect(result.remoteWon).toEqual([])
  })

  it('遠端回報已刪除的 id 從本地移除，並記在 removedIds', () => {
    const result = mergeByUpdatedAt([row('a', '要刪的', 10), row('b', '留著', 10)], [], ['a'])
    expect(result.merged.map((r) => r.id)).toEqual(['b'])
    expect(result.removedIds).toEqual(['a'])
  })

  it('同一筆同時出現在 remote 與刪除清單時，以刪除為準', () => {
    const result = mergeByUpdatedAt([row('a', '本地', 10)], [row('a', '遠端又更新', 20)], ['a'])
    expect(result.merged).toEqual([])
    expect(result.removedIds).toEqual(['a'])
    expect(result.remoteWon).toEqual([])
  })

  it('local／remote 都是空的不會爆炸', () => {
    expect(mergeByUpdatedAt([], [])).toEqual({ merged: [], remoteWon: [], removedIds: [] })
  })

  it('本地沒有、遠端也標示刪除的 id 安靜地被忽略，不記進 removedIds', () => {
    const result = mergeByUpdatedAt([row('a', '留著', 10)], [], ['不存在的 id'])
    expect(result.merged).toEqual([row('a', '留著', 10)])
    expect(result.removedIds).toEqual([])
  })
})
