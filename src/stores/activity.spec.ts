import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useActivityStore } from '@/stores/activity'
import { loadActivity } from '@/db'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useActivityStore()
}

beforeEach(() => localStorage.clear())

describe('activity store', () => {
  it('mergeRemote 聯集新資料，依 id 去重', () => {
    const store = setup()
    store.mergeRemote([
      { id: 'a1', taskId: 't1', actorId: 'u1', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
    ])
    store.mergeRemote([
      { id: 'a1', taskId: 't1', actorId: 'u1', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
      { id: 'a2', taskId: 't1', actorId: 'u1', kind: 'completed', detail: {}, createdAt: 2, updatedAt: 2 },
    ])
    expect(store.items).toHaveLength(2)
  })

  it('forTask 只回傳這筆任務的活動記錄，依 createdAt 排序', () => {
    const store = setup()
    store.mergeRemote([
      { id: 'a2', taskId: 't1', actorId: 'u1', kind: 'completed', detail: {}, createdAt: 20, updatedAt: 20 },
      { id: 'a1', taskId: 't1', actorId: 'u1', kind: 'created', detail: {}, createdAt: 10, updatedAt: 10 },
      { id: 'b1', taskId: 't2', actorId: 'u1', kind: 'created', detail: {}, createdAt: 5, updatedAt: 5 },
    ])
    expect(store.forTask('t1').map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('persist() 把目前狀態寫進 IndexedDB', async () => {
    const store = setup()
    store.mergeRemote([
      { id: 'a1', taskId: 't1', actorId: 'u1', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
    ])
    await store.persist()
    expect((await loadActivity()).map((a) => a.id)).toEqual(['a1'])
  })

  it('load() 從 IndexedDB 讀回先前 persist 的資料', async () => {
    const first = setup()
    first.mergeRemote([
      { id: 'a1', taskId: 't1', actorId: 'u1', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
    ])
    await first.persist()

    const second = setup()
    await second.load()
    expect(second.items.map((a) => a.id)).toEqual(['a1'])
  })
})
