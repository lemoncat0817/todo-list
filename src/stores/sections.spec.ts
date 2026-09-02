import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSectionsStore } from '@/stores/sections'
import { useHistoryStore } from '@/stores/history'
import { loadSections } from '@/db'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { sections: useSectionsStore(), history: useHistoryStore() }
}

beforeEach(() => localStorage.clear())

describe('sections store — 基本 CRUD', () => {
  it('addSection 建立區段，rank 遞增', () => {
    const { sections } = setup()
    const first = sections.addSection('p1', '待處理')
    const second = sections.addSection('p1', '進行中')
    expect(first.projectId).toBe('p1')
    expect(second.rank > first.rank).toBe(true)
  })

  it('forProject 只回傳該專案的區段，依 rank 排序', () => {
    const { sections } = setup()
    sections.addSection('p2', '別的專案的區段')
    const a = sections.addSection('p1', '待處理')
    const b = sections.addSection('p1', '進行中')
    expect(sections.forProject('p1').map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('renameSection 改名並記錄復原', () => {
    const { sections, history } = setup()
    const section = sections.addSection('p1', '待處理')
    sections.renameSection(section.id, '進行中')
    expect(sections.items[0]?.name).toBe('進行中')

    history.undo()
    expect(sections.items[0]?.name).toBe('待處理')
  })

  it('removeSection 拿掉區段，不記錄復原（呼叫端 tasks.ts 才負責復原）', () => {
    const { sections, history } = setup()
    const section = sections.addSection('p1', '待處理')
    const depthAfterAdd = history.depth
    const removed = sections.removeSection(section.id)
    expect(removed?.id).toBe(section.id)
    expect(sections.items).toHaveLength(0)
    // removeSection() 本身不多推一筆復原紀錄——undo 堆疊深度跟建立完
    // 那一刻一樣，沒有因為刪除又往上加。
    expect(history.depth).toBe(depthAfterAdd)
  })

  it('restoreSection 依 rank 插回正確位置', () => {
    const { sections } = setup()
    const a = sections.addSection('p1', 'A')
    const b = sections.addSection('p1', 'B')
    const removed = sections.removeSection(a.id)
    expect(sections.items.map((s) => s.id)).toEqual([b.id])

    if (removed) sections.restoreSection(removed)
    expect(sections.forProject('p1').map((s) => s.id)).toEqual([a.id, b.id])
  })
})

describe('sections store — moveSection', () => {
  it('拖到另一顆之前，rank 落在中間', () => {
    const { sections } = setup()
    const a = sections.addSection('p1', 'A')
    const b = sections.addSection('p1', 'B')
    const c = sections.addSection('p1', 'C')

    sections.moveSection(c.id, a.id, 'before')

    expect(sections.forProject('p1').map((s) => s.id)).toEqual([c.id, a.id, b.id])
  })

  it('不同專案的區段之間不能互相排序', () => {
    const { sections } = setup()
    const a = sections.addSection('p1', 'A')
    const other = sections.addSection('p2', 'Other')
    const beforeRank = a.rank

    sections.moveSection(a.id, other.id, 'before')

    expect(sections.items.find((s) => s.id === a.id)?.rank).toBe(beforeRank)
  })
})

describe('sections store — mergeRemote／persist', () => {
  it('mergeRemote 聯集新資料，依 id 去重', () => {
    const { sections } = setup()
    sections.mergeRemote([{ id: 's1', projectId: 'p1', name: 'A', rank: 'A', updatedAt: 1 }])
    sections.mergeRemote([
      { id: 's1', projectId: 'p1', name: 'A', rank: 'A', updatedAt: 1 },
      { id: 's2', projectId: 'p1', name: 'B', rank: 'B', updatedAt: 2 },
    ])
    expect(sections.items).toHaveLength(2)
  })

  it('flush() 寫進 IndexedDB，load() 讀得回來', async () => {
    const first = setup().sections
    first.addSection('p1', '待處理')
    await first.flush()
    expect((await loadSections()).map((s) => s.name)).toEqual(['待處理'])

    const second = setup().sections
    await second.load()
    expect(second.items.map((s) => s.name)).toEqual(['待處理'])
  })
})
