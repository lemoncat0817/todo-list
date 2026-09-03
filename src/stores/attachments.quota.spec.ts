import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useAttachmentsStore } from '@/stores/attachments'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { SyncHttpError } from '@/sync/restClient'

vi.mock('@/sync/config', () => ({
  isSyncConfigured: true,
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon-key',
}))

function fakeSession(): Session {
  return {
    access_token: 'token', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'u1' },
  } as unknown as Session
}

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const attachments = useAttachmentsStore()
  useAuthStore().session = fakeSession()
  useWorkspaceStore().currentWorkspaceId = 'ws-1'
  return attachments
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('attachments store — 工作區儲存配額（M6）', () => {
  it('用量加上這個檔案會超過 500MB 時，直接拒絕、不打 Storage 上傳', async () => {
    const store = setup()
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      calls.push(`${(options as RequestInit).method} ${String(url)}`)
      if (String(url).includes('workspace_storage_used')) {
        return { ok: true, text: async () => String(500 * 1024 * 1024 - 10) } as Response
      }
      return { ok: true, json: async () => [], text: async () => '' } as Response
    })

    const file = new File(['x'.repeat(100)], 'big.pdf', { type: 'application/pdf' })
    await store.upload('task-1', file)

    expect(store.error).toContain('容量已滿')
    expect(calls.some((c) => c.includes('/storage/v1/object/'))).toBe(false)
    expect(store.forTask('task-1')).toHaveLength(0)
  })

  it('用量還在額度內時正常上傳', async () => {
    const store = setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('workspace_storage_used')) {
        return { ok: true, text: async () => '0' } as Response
      }
      return { ok: true, json: async () => [], text: async () => '' } as Response
    })

    const file = new File(['x'], 'small.pdf', { type: 'application/pdf' })
    await store.upload('task-1', file)

    expect(store.error).toBeNull()
    expect(store.forTask('task-1')).toHaveLength(1)
  })

  it('查詢用量本身失敗時不擋上傳——只是提前檢查，不是唯一防線', async () => {
    const store = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('workspace_storage_used')) {
        return { ok: false, status: 500, text: async () => 'boom' } as Response
      }
      return { ok: true, json: async () => [], text: async () => '' } as Response
    })

    const file = new File(['x'], 'small.pdf', { type: 'application/pdf' })
    await store.upload('task-1', file)

    expect(store.forTask('task-1')).toHaveLength(1)
  })

  it('沒有目前工作區（純本機或尚未切換）時跳過檢查，不多打一次網路', async () => {
    const pinia = createPinia()
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const store = useAttachmentsStore()
    useAuthStore().session = fakeSession()
    // 刻意不設定 currentWorkspaceId

    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url))
      return { ok: true, json: async () => [], text: async () => '' } as Response
    })

    await store.upload('task-1', new File(['x'], 'x.pdf'))

    expect(calls.some((c) => c.includes('workspace_storage_used'))).toBe(false)
  })

  it('伺服器端 trigger 擋下時（略過前端檢查的情況），錯誤說法一樣是配額訊息', async () => {
    const store = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('workspace_storage_used')) {
        return { ok: true, text: async () => '0' } as Response
      }
      if (String(url).includes('/rest/v1/attachments')) {
        return {
          ok: false, status: 400,
          text: async () => JSON.stringify({ message: '這個工作區的附件容量已滿（上限 500MB），請先刪除不需要的附件' }),
        } as Response
      }
      return { ok: true, text: async () => '' } as Response
    })

    await expect(store.upload('task-1', new File(['x'], 'x.pdf'))).rejects.toThrow()

    expect(store.error).toContain('容量已滿')
  })
})

describe('SyncHttpError 攜帶的訊息', () => {
  it('包含伺服器回傳的原始內容，讓上層可以判斷是不是配額錯誤', () => {
    const err = new SyncHttpError('attachments', 'upsert', 400, '容量已滿的訊息片段')
    expect(err.message).toContain('容量已滿的訊息片段')
  })
})
