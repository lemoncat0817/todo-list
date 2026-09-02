import { describe, it, expect, vi, afterEach } from 'vitest'
import { pullTable, type TableBinding } from './tableSync'

interface Row {
  id: string
  name: string
  updatedAt: number
}

const binding: TableBinding<Row> = {
  table: 'widgets',
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
