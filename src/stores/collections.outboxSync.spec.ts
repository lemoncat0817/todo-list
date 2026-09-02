import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCollectionsStore } from '@/stores/collections'
import { loadOutbox } from '@/db'

/**
 * collections.ts 的 flush() 排入離線操作佇列——跟
 * tasks.outboxSync.spec.ts 同一套邏輯，套用在 projects/tags/filters。
 * 拆成獨立檔案的理由也相同：vi.mock('@/sync/config', ...) 是檔案層級。
 */
vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useCollectionsStore()
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('flush() 排入離線操作佇列（已設定 Supabase）', () => {
  it('新增專案排一筆 project.create', async () => {
    const store = setup()
    await store.load()

    const project = store.addProject('工作')
    await store.flush()

    const ops = await loadOutbox()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.kind).toBe('project.create')
    expect(ops[0]?.targetId).toBe(project.id)
    expect(ops[0]?.payload).toMatchObject({ id: project.id, name: '工作' })
  })

  it('只改專案顏色時，補丁只包含 color', async () => {
    const store = setup()
    await store.load()
    const project = store.addProject('原始')
    await store.flush()

    store.updateProject(project.id, { color: '#dc2626' })
    await store.flush()

    const patchOp = (await loadOutbox()).find((o) => o.kind === 'project.patch')
    expect(patchOp?.payload).toMatchObject({ color: '#dc2626' })
    expect(patchOp?.payload).not.toHaveProperty('name')
  })

  it('刪除專案排一筆 project.delete', async () => {
    const store = setup()
    await store.load()
    const project = store.addProject('要刪除的')
    await store.flush()

    store.removeProject(project.id)
    await store.flush()

    const deleteOp = (await loadOutbox()).find((o) => o.kind === 'project.delete')
    expect(deleteOp?.targetId).toBe(project.id)
    expect(typeof deleteOp?.payload.deleted_at).toBe('number')
  })

  it('新增標籤排一筆 tag.create，改名排 tag.patch', async () => {
    const store = setup()
    await store.load()
    const tag = store.addTag('緊急')
    await store.flush()
    store.updateTag(tag.id, { name: '非常緊急' })
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.some((o) => o.kind === 'tag.create' && o.targetId === tag.id)).toBe(true)
    const patchOp = ops.find((o) => o.kind === 'tag.patch' && o.targetId === tag.id)
    expect(patchOp?.payload).toMatchObject({ name: '非常緊急' })
  })

  it('新增篩選器排一筆 filter.create，帶完整的 query', async () => {
    const store = setup()
    await store.load()
    const filter = store.addFilter('本週', 'due:week')
    await store.flush()

    const ops = await loadOutbox()
    expect(ops[0]?.kind).toBe('filter.create')
    expect(ops[0]?.payload).toMatchObject({ id: filter.id, name: '本週', query: 'due:week' })
  })

  it('mergeRemote 寫入的資料不會被誤判成本地變更、推回 outbox', async () => {
    const store = setup()
    await store.load()

    store.mergeRemote({
      projects: [{ id: 'remote-p1', name: '遠端專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false }],
      tags: [],
      filters: [],
    })
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.some((o) => o.targetId === 'remote-p1')).toBe(false)
  })

  it('合併之後使用者真的編輯同一筆資料時，補丁照常產生', async () => {
    const store = setup()
    await store.load()

    store.mergeRemote({
      projects: [{ id: 'remote-p1', name: '遠端專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false }],
      tags: [],
      filters: [],
    })
    await store.flush()

    store.updateProject('remote-p1', { name: '使用者改的名字' })
    await store.flush()

    const patchOp = (await loadOutbox()).find((o) => o.kind === 'project.patch' && o.targetId === 'remote-p1')
    expect(patchOp?.payload).toMatchObject({ name: '使用者改的名字' })
  })
})
