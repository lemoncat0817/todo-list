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
