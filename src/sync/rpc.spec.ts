import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Op } from '@/db/schema'
import { SyncHttpError } from './restClient'
import { sendOp } from './rpc'

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response as Response)
}

afterEach(() => vi.restoreAllMocks())

const baseOp = (overrides: Partial<Op>): Op => ({
  id: 'op-1',
  kind: 'task.patch',
  targetId: 'task-1',
  payload: {},
  createdAt: 1,
  attempts: 0,
  ...overrides,
})

describe('sendOp', () => {
  it('task.create 打 create_task，帶 op_id 跟完整列', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)
    const op = baseOp({ kind: 'task.create', payload: { id: 'task-1', task_name: 'x' } })

    await sendOp(op, 'token')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/rpc/create_task')
    expect(JSON.parse(options.body as string)).toEqual({ p_op_id: 'op-1', p_row: { id: 'task-1', task_name: 'x' } })
  })

  it('task.patch 打 apply_task_patch，帶 targetId 跟 payload', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)
    const op = baseOp({ kind: 'task.patch', targetId: 'task-9', payload: { notes: '改備註' } })

    await sendOp(op, 'token')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/v1/rpc/apply_task_patch')
    expect(JSON.parse(options.body as string)).toEqual({ p_op_id: 'op-1', p_task_id: 'task-9', p_patch: { notes: '改備註' } })
  })

  it('task.delete 也是打 apply_task_patch——刪除機制上就是一種補丁', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)
    const op = baseOp({ kind: 'task.delete', targetId: 'task-9', payload: { deleted_at: 12345 } })

    await sendOp(op, 'token')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/rest/v1/rpc/apply_task_patch')
  })

  it.each([
    ['project.create', 'create_project'],
    ['project.patch', 'apply_project_patch'],
    ['tag.create', 'create_tag'],
    ['tag.patch', 'apply_tag_patch'],
    ['tag.delete', 'apply_tag_patch'],
    ['filter.create', 'create_filter'],
    ['filter.patch', 'apply_filter_patch'],
    ['filter.delete', 'apply_filter_patch'],
    ['project.delete', 'apply_project_patch'],
  ] as const)('%s 打 %s', async (kind, fn) => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)
    await sendOp(baseOp({ kind, payload: { id: 'x' } }), 'token')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain(`/rest/v1/rpc/${fn}`)
  })

  it('帶上必要的 header', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)
    await sendOp(baseOp({}), 'token-abc')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const h = options.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer token-abc')
    expect('apikey' in h).toBe(true)
  })

  it('HTTP 失敗時丟出 SyncHttpError，operation 是 rpc', async () => {
    mockFetch({ ok: false, status: 403, text: async () => 'permission denied' } as Response)

    await expect(sendOp(baseOp({}), 'token')).rejects.toThrow(SyncHttpError)
    await expect(sendOp(baseOp({}), 'token')).rejects.toMatchObject({
      table: 'apply_task_patch',
      operation: 'rpc',
      status: 403,
    })
  })

  it('create 撞主鍵（23505 *_pkey）視為已成功，不丟錯——避免 outbox 毒丸重試', async () => {
    mockFetch({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          code: '23505',
          details: null,
          hint: null,
          message: 'duplicate key value violates unique constraint "tasks_pkey"',
        }),
    } as Response)

    await expect(
      sendOp(baseOp({ kind: 'task.create', payload: { id: 'task-1', task_name: 'x' } }), 'token'),
    ).resolves.toBeUndefined()
  })

  it('非主鍵的 23505（例如 inbox unique）仍然丟錯，不能當成 create 成功', async () => {
    mockFetch({
      ok: false,
      status: 409,
      text: async () =>
        JSON.stringify({
          code: '23505',
          message: 'duplicate key value violates unique constraint "projects_one_inbox_per_workspace"',
        }),
    } as Response)

    await expect(
      sendOp(baseOp({ kind: 'project.create', payload: { id: 'p1', name: '收件匣' } }), 'token'),
    ).rejects.toThrow(SyncHttpError)
  })
})
