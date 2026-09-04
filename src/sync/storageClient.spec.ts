import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  attachmentStoragePath,
  deleteAttachmentFile,
  downloadAttachmentFile,
  uploadAttachmentFile,
} from './storageClient'
import { SyncHttpError } from './restClient'

vi.mock('./config', () => ({
  isSyncConfigured: true,
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon-key-123',
}))

afterEach(() => vi.restoreAllMocks())

describe('storageClient', () => {
  it('attachmentStoragePath 產生「taskId/attachmentId-fileName」路徑', () => {
    expect(attachmentStoragePath('task-1', 'att-1', '會議記錄.pdf')).toBe('task-1/att-1-會議記錄.pdf')
  })

  it('deleteAttachmentFile 對 /storage/v1/object/attachments 發送 DELETE，body 包含 { prefixes: [path] }', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return { ok: true, text: async () => '[]' } as Response
    })

    await deleteAttachmentFile('task-1/att-1-file.pdf', 'user-token')

    expect(capturedUrl).toBe('https://example.test/storage/v1/object/attachments')
    expect(capturedInit?.method).toBe('DELETE')

    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBe('Bearer user-token')
    expect(headers.apikey).toBe('anon-key-123')

    // 關鍵：body 不能為空，必須是帶有 prefixes 陣列的 JSON 字串，以符合 Fastify 與 Supabase Storage API 規範
    expect(capturedInit?.body).toBe(JSON.stringify({ prefixes: ['task-1/att-1-file.pdf'] }))
  })

  it('deleteAttachmentFile 失敗時拋出 SyncHttpError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"statusCode":"400","error":"FastifyError","message":"error"}',
    } as Response)

    await expect(deleteAttachmentFile('task-1/file.pdf', 'token')).rejects.toThrow(SyncHttpError)
  })

  it('uploadAttachmentFile 使用 POST 上傳檔案，並帶上正確的 Content-Type 與 Authorization', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return { ok: true, text: async () => '' } as Response
    })

    const file = new File(['content'], 'test.png', { type: 'image/png' })
    await uploadAttachmentFile('task-1/att-1-test.png', file, 'user-token')

    expect(capturedUrl).toBe('https://example.test/storage/v1/object/attachments/task-1/att-1-test.png')
    expect(capturedInit?.method).toBe('POST')

    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers.Authorization).toBe('Bearer user-token')
    expect(capturedInit?.body).toBe(file)
  })

  it('downloadAttachmentFile 發送 GET 請求，headers 不含 Content-Type', async () => {
    let capturedInit: RequestInit | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedInit = init
      const blob = new Blob(['dummy content'], { type: 'text/plain' })
      return { ok: true, blob: async () => blob, text: async () => '' } as unknown as Response
    })

    // 模擬 DOM 物件與 URL
    const clickSpy = vi.fn()
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      set href(_v: string) {},
      set download(_v: string) {},
      click: clickSpy,
    } as unknown as HTMLElement)
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()

    await downloadAttachmentFile('task-1/att-1-test.txt', 'test.txt', 'user-token')

    expect(capturedInit?.method).toBe('GET')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer user-token')
    expect(clickSpy).toHaveBeenCalled()

    createElementSpy.mockRestore()
    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
  })
})
