import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useCommentsStore } from '@/stores/comments'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { loadOutbox } from '@/db'

vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))

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
  return useCommentsStore()
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('comments store — CRUD', () => {
  it('新增留言，作者是目前登入的使用者', () => {
    const store = setup()
    useAuthStore().session = fakeSession('alice')

    const comment = store.add('task-1', '這個要優先處理')
    expect(comment.taskId).toBe('task-1')
    expect(comment.authorId).toBe('alice')
    expect(comment.body).toBe('這個要優先處理')
    expect(store.forTask('task-1')).toEqual([comment])
  })

  it('forTask 依 createdAt 排序，只回傳這筆任務的留言', () => {
    const store = setup()
    useAuthStore().session = fakeSession()

    store.add('task-1', '第一則')
    store.add('task-2', '別的任務')
    store.add('task-1', '第二則')

    expect(store.forTask('task-1').map((c) => c.body)).toEqual(['第一則', '第二則'])
  })

  it('編輯留言只改 body 與 updatedAt', () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    const comment = store.add('task-1', '原始內容')

    store.update(comment.id, '改過的內容')

    expect(store.forTask('task-1')[0]?.body).toBe('改過的內容')
    expect(store.forTask('task-1')[0]?.createdAt).toBe(comment.createdAt)
  })

  it('刪除留言後從清單消失', () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    const comment = store.add('task-1', '要刪掉的')

    store.remove(comment.id)

    expect(store.forTask('task-1')).toEqual([])
  })

  it('新增／編輯／刪除都可以用 Ctrl+Z 復原', () => {
    const store = setup()
    const history = useHistoryStore()
    useAuthStore().session = fakeSession()

    const comment = store.add('task-1', '原始')
    store.update(comment.id, '改過')
    store.remove(comment.id)
    expect(store.forTask('task-1')).toEqual([])

    void history.undo() // 復原刪除
    expect(store.forTask('task-1')[0]?.body).toBe('改過')

    void history.undo() // 復原編輯
    expect(store.forTask('task-1')[0]?.body).toBe('原始')

    void history.undo() // 復原新增
    expect(store.forTask('task-1')).toEqual([])
  })
})

describe('comments store — flush() 排入離線操作佇列（已設定 Supabase）', () => {
  it('新增留言排一筆 comment.create', async () => {
    const store = setup()
    useAuthStore().session = fakeSession('alice')
    await store.load()

    const comment = store.add('task-1', '討論一下')
    await store.flush()

    const ops = await loadOutbox()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.kind).toBe('comment.create')
    expect(ops[0]?.targetId).toBe(comment.id)
    expect(ops[0]?.payload).toMatchObject({ id: comment.id, task_id: 'task-1', body: '討論一下' })
    expect(ops[0]?.payload).not.toHaveProperty('author_id')
  })

  it('編輯留言只補丁 body', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    await store.load()
    const comment = store.add('task-1', '原始')
    await store.flush()

    store.update(comment.id, '改過的')
    await store.flush()

    const patchOp = (await loadOutbox()).find((o) => o.kind === 'comment.patch')
    expect(patchOp?.payload).toMatchObject({ body: '改過的' })
    expect(patchOp?.payload).not.toHaveProperty('task_id')
    expect(patchOp?.payload).not.toHaveProperty('created_at')
  })

  it('刪除留言排一筆 comment.delete', async () => {
    const store = setup()
    useAuthStore().session = fakeSession()
    await store.load()
    const comment = store.add('task-1', '要刪掉的')
    await store.flush()

    store.remove(comment.id)
    await store.flush()

    const deleteOp = (await loadOutbox()).find((o) => o.kind === 'comment.delete')
    expect(deleteOp?.targetId).toBe(comment.id)
    expect(deleteOp?.payload).toHaveProperty('deleted_at')
  })

  it('mergeRemote 寫入的資料不會被誤判成本地變更、推回 outbox', async () => {
    const store = setup()
    await store.load()

    store.mergeRemote([
      { id: 'remote-c1', taskId: 'task-1', authorId: 'bob', body: '遠端留言', createdAt: 1, updatedAt: 1 },
    ])
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.some((o) => o.targetId === 'remote-c1')).toBe(false)
  })
})
