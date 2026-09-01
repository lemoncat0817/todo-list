import { describe, it, expect, vi, afterEach } from 'vitest'
import { pullTable, pushTable, type TableBinding } from './tableSync'

interface Row {
  id: string
  name: string
  updatedAt: number
}

const binding: TableBinding<Row> = {
  table: 'widgets',
  toRemote: (row) => ({ id: row.id, name: row.name, updated_at: row.updatedAt, deleted_at: null }),
  fromRemote: (row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }),
  normalize: (raw) => {
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
    return { id: r.id, name: r.name, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 }
  },
}

function mockFetch(response: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => response } as Response)
}

afterEach(() => vi.restoreAllMocks())

describe('pushTable', () => {
  it('沒有變動時不呼叫網路', async () => {
    const fetchMock = mockFetch([])
    await pushTable(binding, [], new Map(), 'token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('本地新增／變動的列送出 upsert，回傳更新後的指紋', async () => {
    const fetchMock = mockFetch([])
    const row: Row = { id: 'a', name: '新的', updatedAt: 10 }

    const next = await pushTable(binding, [row], new Map(), 'token')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(options.body as string)).toEqual([binding.toRemote(row)])
    expect(next.get('a')).toBe(JSON.stringify(row))
  })

  it('指紋裡有、本地沒有的 id 送出墓碑，且指紋裡不再有它', async () => {
    const fingerprint = new Map([['a', JSON.stringify({ id: 'a', name: '舊', updatedAt: 1 })]])
    const fetchMock = mockFetch([])

    const next = await pushTable(binding, [], fingerprint, 'token')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string) as { id: string; deleted_at: number; updated_at: number }[]
    // updated_at 也要帶：這個 id 如果從沒推送成功過，遠端得走 INSERT 而不是
    // UPDATE，沒有 updated_at 就等於永遠拉不到（見 rowMapping.ts 的
    // makeTombstone 註解）——不是只有 deleted_at 就夠。
    expect(body).toEqual([
      { id: 'a', deleted_at: expect.any(Number) as unknown as number, updated_at: expect.any(Number) as unknown as number },
    ])
    expect(next.has('a')).toBe(false)
  })

  it('同一輪裡又有變動的列、又有被刪除的列時，兩者分開送出——不能合成一支請求', async () => {
    // 這一條釘住真實發生過的 PGRST102「All object keys must match」：
    // binding.toRemote() 回傳的列有完整欄位，makeTombstone() 只有三個
    // 欄位，混進同一個 JSON 陣列送給 PostgREST 的批次 upsert 會被整批
    // 拒絕——而且失敗發生在指紋更新之前，下一輪還是同一份 diff，永遠卡死。
    const fingerprint = new Map([['gone', JSON.stringify({ id: 'gone', name: '舊', updatedAt: 1 })]])
    const fetchMock = mockFetch([])
    const row: Row = { id: 'b', name: '變動的', updatedAt: 10 }

    const next = await pushTable(binding, [row], fingerprint, 'token')

    expect(fetchMock, '一個 upsert、一個刪除，該打兩支請求').toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse((options as RequestInit).body as string) as Record<string, unknown>[])
    for (const body of bodies) {
      const keySets = body.map((row) => Object.keys(row).sort().join(','))
      expect(keySets.every((k) => k === keySets[0]), '同一支請求裡每個物件的 key 集合要一致').toBe(true)
    }
    expect(bodies.flat()).toEqual(
      expect.arrayContaining([
        binding.toRemote(row),
        { id: 'gone', deleted_at: expect.any(Number) as unknown as number, updated_at: expect.any(Number) as unknown as number },
      ]),
    )
    expect(next.get('b')).toBe(JSON.stringify(row))
    expect(next.has('gone')).toBe(false)
  })
})

describe('pullTable', () => {
  it('把有效的列 normalize 之後回傳，帶不過驗證的安靜略過', async () => {
    mockFetch([{ id: 'a' /* 缺 name */ }, { id: 'b', name: '有效的', updated_at: 5 }])

    const result = await pullTable(binding, 0, 'token')

    expect(result.live).toEqual([{ id: 'b', name: '有效的', updatedAt: 5 }])
    expect(result.deletedIds).toEqual([])
  })

  it('墓碑另外分到 deletedIds，不進 live', async () => {
    mockFetch([{ id: 'a', deleted_at: 999 }, { id: 'b', name: '還活著', updated_at: 1 }])

    const result = await pullTable(binding, 0, 'token')

    expect(result.deletedIds).toEqual(['a'])
    expect(result.live.map((r) => r.id)).toEqual(['b'])
  })

  it('用傳入的 lastPulledAt 當游標', async () => {
    const fetchMock = mockFetch([])
    await pullTable(binding, 123456, 'token')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('updated_at=gt.123456')
  })
})
