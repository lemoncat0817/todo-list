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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, text: async () => '' }) as Response)
    await store.upload('task-1', new File(['x'], 'x.txt'))
    const attachment = store.forTask('task-1')[0]
    if (!attachment) throw new Error('setup failed')

    await store.remove(attachment)

    expect(store.forTask('task-1')).toHaveLength(0)
  })

  it('mergeRemote 寫入的資料不會被誤判成需要重新上傳', async () => {
    const store = setup()
    store.mergeRemote([
      { id: 'remote-a1', taskId: 'task-1', uploaderId: 'bob', fileName: '遠端檔案.pdf', fileSize: 100, contentType: 'application/pdf', storagePath: 'task-1/remote-a1-遠端檔案.pdf', createdAt: 1, updatedAt: 1 },
    ])
    expect(store.forTask('task-1')).toHaveLength(1)
    expect(store.forTask('task-1')[0]?.uploaderId).toBe('bob')
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
