import { describe, it, expect, vi, afterEach } from 'vitest'
import { SyncHttpError, fetchRowsSince, upsertRows } from './restClient'

/**
 * 用 vi.spyOn(globalThis, 'fetch') 頂替網路層，比照專案既有的
 * spy＋afterEach 還原風格（test/helpers.ts 的 stubDialogs）。
 * 不打真正的 Supabase——這支 client 該測的是「組出的請求對不對」，
 * 不是「Supabase 本身有沒有在運作」。
 */
function mockFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response as Response)
}

afterEach(() => vi.restoreAllMocks())

describe('fetchRowsSince', () => {
  it('組出依 updated_at 篩選的 GET 請求，帶上必要的 header', async () => {
    const rows = [{ id: 'a' }]
    const fetchMock = mockFetch({ ok: true, json: async () => rows } as Response)

    const result = await fetchRowsSince('tasks', 1000, 'token-123')

    expect(result).toEqual(rows)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/tasks')
    expect(url).toContain('updated_at=gt.1000')
    expect(options.method).toBe('GET')
    const h = options.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer token-123')
    // 測試環境沒有設定 VITE_SUPABASE_ANON_KEY，這裡只驗證有帶這個 header，
    // 不驗證實際的值——那是 sync/config.ts 的責任，不是這支 client 的
    expect('apikey' in h).toBe(true)
  })

  it('HTTP 失敗時拋出帶有表名與狀態碼的錯誤，方便同步狀態顯示', async () => {
    mockFetch({ ok: false, status: 401, text: async () => 'invalid token' } as Response)

    await expect(fetchRowsSince('tasks', 0, 'bad-token')).rejects.toThrow(SyncHttpError)
    await expect(fetchRowsSince('tasks', 0, 'bad-token')).rejects.toMatchObject({
      table: 'tasks',
      operation: 'fetch',
      status: 401,
    })
  })

  it('錯誤內文是 PostgREST 的 JSON 時，解析出 code 供上層區分失敗類型', async () => {
    mockFetch({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ code: 'PT001', details: null, hint: null, message: '任務已經被其他成員刪除' }),
    } as Response)

    await expect(fetchRowsSince('tasks', 0, 'token')).rejects.toMatchObject({ code: 'PT001' })
  })

  it('錯誤內文不是 JSON 時，code 是 null 而不是丟出解析例外', async () => {
    mockFetch({ ok: false, status: 500, text: async () => '<html>502 Bad Gateway</html>' } as Response)

    await expect(fetchRowsSince('tasks', 0, 'token')).rejects.toMatchObject({ code: null })
  })
})

describe('upsertRows', () => {
  it('空陣列不發出請求——沒有東西要送就不必打一次 API', async () => {
    const fetchMock = mockFetch({ ok: true } as Response)
    await upsertRows('tasks', [], 'token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('組出 on_conflict=id 的 upsert 請求，body 是整批列', async () => {
    const fetchMock = mockFetch({ ok: true } as Response)
    const rows = [{ id: 'a' }, { id: 'b' }]

    await upsertRows('tasks', rows, 'token-123')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('on_conflict=id')
    expect(options.method).toBe('POST')
    const h = options.headers as Record<string, string>
    expect(h.Prefer).toContain('resolution=merge-duplicates')
    expect(JSON.parse(options.body as string)).toEqual(rows)
  })

  it('HTTP 失敗時拋出錯誤', async () => {
    mockFetch({ ok: false, status: 500, text: async () => 'server error' } as Response)
    await expect(upsertRows('tasks', [{ id: 'a' }], 'token')).rejects.toThrow(SyncHttpError)
  })

  it('conflictColumn 可覆寫——device_cursors（M6）的主鍵不是 id', async () => {
    const fetchMock = mockFetch({ ok: true } as Response)
    await upsertRows('device_cursors', [{ device_id: 'd1', last_synced_at: 1 }], 'token', 'device_id')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('on_conflict=device_id')
  })
})
