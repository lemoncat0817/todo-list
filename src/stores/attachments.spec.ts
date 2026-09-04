import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useAttachmentsStore } from '@/stores/attachments'
import { useAuthStore } from '@/stores/auth'
import { loadAttachments } from '@/db'

vi.mock('@/sync/config', () => ({
  isSyncConfigured: true,
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon-key',
}))

function fakeSession(userId = 'u1'): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  } as unknown as Session
}

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useAttachmentsStore()
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('attachments store — upload/remove/download 直接打網路，不走 outbox', () => {
  it('upload() 依序打 Storage 上傳與 REST metadata 新增，成功後寫進本地', async () => {
    const store = setup()
    useAuthStore().session = fakeSession('alice')
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      calls.push(`${(options as RequestInit).method} ${String(url)}`)
      return { ok: true, json: async () => [], text: async () => '' } as Response
    })

    const file = new File(['hello'], '報告.pdf', { type: 'application/pdf' })
    await store.upload('task-1', file)

    expect(calls[0]).toContain('/storage/v1/object/attachments/task-1/')
    expect(calls[1]).toContain('/rest/v1/attachments')
    expect(store.forTask('task-1')).toHaveLength(1)
    expect(store.forTask('task-1')[0]?.fileName).toBe('報告.pdf')
    expect(store.forTask('task-1')[0]?.uploaderId).toBe('alice')
    expect(store.uploading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('upload() 失敗時設定 error，不寫進本地，重新拋出例外', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 400, text: async () => 'RLS violation',
    } as Response)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const file = new File(['x'], 'x.txt', { type: 'text/plain' })
    await expect(store.upload('task-1', file)).rejects.toThrow()

    expect(store.forTask('task-1')).toHaveLength(0)
    expect(store.error).toBe('伺服器暫時無法處理，請稍後再試一次')
  })

  it('upload() 失敗訊息不會宣稱「自動重試」——這裡是使用者按一次的單次動作，沒有背景重試', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(store.upload('task-1', new File(['x'], 'x.txt'))).rejects.toThrow()
    expect(store.error).not.toContain('自動重試')
    expect(store.error).toBe('目前連不上網路，請檢查連線後重試')
  })

  it('remove() 依序打 Storage 刪除與 REST 軟刪除，成功後從本地清單移除', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    const calls: { url: string; method: string; body?: string | undefined }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const method = (init as RequestInit)?.method ?? 'GET'
      const body = (init as RequestInit)?.body as string | undefined
      calls.push({ url: String(url), method, body })
      return { ok: true, text: async () => '' } as Response
    })
    await store.upload('task-1', new File(['x'], 'x.txt'))
    const attachment = store.forTask('task-1')[0]
    if (!attachment) throw new Error('setup failed')

    calls.length = 0
    await store.remove(attachment)

    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toBe('https://example.test/storage/v1/object/attachments')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ prefixes: [attachment.storagePath] })
    expect(calls[1]?.method).toBe('PATCH')
    expect(calls[1]?.url).toBe(`https://example.test/rest/v1/attachments?id=eq.${attachment.id}`)
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      deleted_at: expect.any(Number),
      updated_at: expect.any(Number),
    })
    expect(store.forTask('task-1')).toHaveLength(0)
  })

  it('42501 權限不足時，顯示友善的權限不足提示', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: '42501', message: 'permission denied' }),
    } as Response)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(store.upload('task-1', new File(['x'], 'x.txt'))).rejects.toThrow()
    expect(store.error).toBe('你沒有權限修改這筆任務的附件')
  })

  it('mergeRemote 寫入的資料不會被誤判成需要重新上傳', async () => {
    const store = setup()
    store.mergeRemote([
      { id: 'remote-a1', taskId: 'task-1', uploaderId: 'bob', fileName: '遠端檔案.pdf', fileSize: 100, contentType: 'application/pdf', storagePath: 'task-1/remote-a1-遠端檔案.pdf', createdAt: 1, updatedAt: 1 },
    ])
    expect(store.forTask('task-1')).toHaveLength(1)
    expect(store.forTask('task-1')[0]?.uploaderId).toBe('bob')
  })

  it('mergeRemote 替換整個清單，當遠端已刪除時本地清單也同步清空', async () => {
    const store = setup()
    store.mergeRemote([
      { id: 'remote-a1', taskId: 'task-1', uploaderId: 'bob', fileName: '遠端檔案.pdf', fileSize: 100, contentType: 'application/pdf', storagePath: 'task-1/remote-a1-遠端檔案.pdf', createdAt: 1, updatedAt: 1 },
    ])
    expect(store.forTask('task-1')).toHaveLength(1)

    // 遠端同步拉取後，已刪除的列會被排除，傳入排除後的清單
    store.mergeRemote([])
    expect(store.forTask('task-1')).toHaveLength(0)
  })

  it('download() 遇到 Storage 404 (NoSuchKey) 時自動移除本地幽靈附件並提示已刪除', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    const att = { id: 'a1', taskId: 'task-1', uploaderId: 'bob', fileName: 'x.pdf', fileSize: 10, contentType: 'application/pdf', storagePath: 'task-1/a1-x.pdf', createdAt: 1, updatedAt: 1 }
    store.mergeRemote([att])
    expect(store.forTask('task-1')).toHaveLength(1)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found', code: 'NoSuchKey' }),
    } as Response)

    await store.download(att)

    expect(store.forTask('task-1')).toHaveLength(0)
    expect(store.error).toBe('此附件已被其他成員刪除')
  })
})

describe('attachments store — 本地快取', () => {
  it('persist() 之後 load() 可以讀回同一份資料', async () => {
    const first = setup()
    first.mergeRemote([
      { id: 'a1', taskId: 't1', uploaderId: 'u1', fileName: 'x.txt', fileSize: 1, contentType: 'text/plain', storagePath: 't1/a1-x.txt', createdAt: 1, updatedAt: 1 },
    ])
    await first.persist()

    expect((await loadAttachments()).map((a) => a.id)).toEqual(['a1'])

    const second = setup()
    await second.load()
    expect(second.items.map((a) => a.id)).toEqual(['a1'])
  })
})
