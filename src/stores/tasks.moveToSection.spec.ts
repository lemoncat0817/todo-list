import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { useSectionsStore } from '@/stores/sections'
import { useHistoryStore } from '@/stores/history'
import { makeTask } from '@/test/helpers'

/**
 * 看板拖曳的核心：moveToSection()／removeSection()。獨立成一支檔案，
 * 理由跟這次其他新功能一樣——只驗證新增的部分，tasks.spec.ts 既有的
 * move()／removeProject() 等測試不動。
 */
function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { tasks: useTasksStore(), sections: useSectionsStore(), history: useHistoryStore() }
}

beforeEach(() => localStorage.clear())

describe('tasks store — moveToSection', () => {
  it('拖到同一個區段的某張卡片之前，rank 落在該區段內的正確位置', () => {
    const { tasks } = setup()
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: 's1', order: 1 }),
      makeTask('B', false, { id: 'b', projectId: 'p1', sectionId: 's1', order: 2 }),
      makeTask('C', false, { id: 'c', projectId: 'p1', sectionId: 's1', order: 3 }),
    ]

    tasks.moveToSection('c', 's1', 'a', 'before')

    const order = [...tasks.items].sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((t) => t.id)
    expect(order).toEqual(['c', 'a', 'b'])
    const listTasks = tasks.groupsOf({ kind: 'project', id: 'p1' })[0]?.tasks.map((t) => t.id)
    expect(listTasks).toEqual(['c', 'a', 'b'])
  })

  it('拖到別的區段（沒指定目標卡片）附加到該欄最後面，section_id 正確更新', () => {
    const { tasks } = setup()
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: 's1', order: 1 }),
      makeTask('B', false, { id: 'b', projectId: 'p1', sectionId: 's2', order: 2 }),
    ]

    tasks.moveToSection('a', 's2', null)

    const moved = tasks.items.find((t) => t.id === 'a')
    expect(moved?.sectionId).toBe('s2')
    // 附加到 s2 欄最後面：排在原本就在 s2 的 b 後面。
    const s2Tasks = tasks.items.filter((t) => t.sectionId === 's2').sort((x, y) => (x.rank < y.rank ? -1 : 1))
    expect(s2Tasks.map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('別的區段裡「看似鄰居」的任務不會污染目標區段內的排序計算', () => {
    // 這是這次實作時特別在意的正確性問題：如果 rank 鄰居取自全域排序
    // 而不是先篩到目標區段，插進來的位置可能會被別的欄的任務影響。
    const { tasks } = setup()
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: 's1', order: 1 }),
      // 全域排序上夾在 A、B 中間，但屬於別的區段——不該影響 s1 內部的計算。
      makeTask('X', false, { id: 'x', projectId: 'p1', sectionId: 's2', order: 2 }),
      makeTask('B', false, { id: 'b', projectId: 'p1', sectionId: 's1', order: 3 }),
      makeTask('New', false, { id: 'new', projectId: 'p1', sectionId: null, order: 4 }),
    ]

    tasks.moveToSection('new', 's1', 'b', 'before')

    const s1Tasks = tasks.items.filter((t) => t.sectionId === 's1').sort((x, y) => (x.rank < y.rank ? -1 : 1))
    expect(s1Tasks.map((t) => t.id)).toEqual(['a', 'new', 'b'])
  })

  it('可以復原', () => {
    const { tasks, history } = setup()
    tasks.items = [makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: 's1', order: 1 })]
    const before = { sectionId: tasks.items[0]?.sectionId, rank: tasks.items[0]?.rank }

    tasks.moveToSection('a', 's2', null)
    expect(tasks.items[0]?.sectionId).toBe('s2')

    history.undo()
    expect(tasks.items[0]?.sectionId).toBe(before.sectionId)
    expect(tasks.items[0]?.rank).toBe(before.rank)
  })
})

describe('tasks store — removeSection', () => {
  it('刪除區段時，裡面的任務移出（section_id 清成 null），不刪除任務', () => {
    const { tasks, sections } = setup()
    const section = sections.addSection('p1', '待處理')
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: section.id }),
      makeTask('B', false, { id: 'b', projectId: 'p1', sectionId: null }),
    ]

    tasks.removeSection(section.id)

    expect(sections.items).toHaveLength(0)
    expect(tasks.items).toHaveLength(2)
    expect(tasks.items.find((t) => t.id === 'a')?.sectionId).toBeNull()
  })

  it('可以復原：區段跟任務的區段指派都回來', () => {
    const { tasks, sections, history } = setup()
    const section = sections.addSection('p1', '待處理')
    tasks.items = [makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: section.id })]

    tasks.removeSection(section.id)
    expect(sections.items).toHaveLength(0)

    history.undo()
    expect(sections.items.map((s) => s.id)).toEqual([section.id])
    expect(tasks.items.find((t) => t.id === 'a')?.sectionId).toBe(section.id)
  })
})
