import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTodoTaskStore } from '@/stores/todoTask'
import { makeTask } from '@/test/helpers'
import type { Recurrence } from '@/db/schema'

/**
 * 子任務、專案、標籤的關聯處理，以及重複規則與排序。
 * 這些邏輯是突變測試找出來沒有被守住的部分。
 */

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useTodoTaskStore()
}

const daily = (patch: Partial<Recurrence> = {}): Recurrence => ({
  freq: 'daily',
  interval: 1,
  byDay: [],
  byMonthDay: null,
  until: null,
  count: null,
  ...patch,
})

beforeEach(() => {
  localStorage.clear()
})

describe('子任務', () => {
  it('刪除父項時連同子任務一併刪除', async () => {
    const store = setup()
    await store.init()
    store.todoList = [
      makeTask('父', false, { id: 'p', order: 0 }),
      makeTask('子一', false, { id: 'c1', parentId: 'p', order: 1 }),
      makeTask('子二', false, { id: 'c2', parentId: 'p', order: 2 }),
      makeTask('不相干', false, { id: 'x', order: 3 }),
    ]

    store.removeTask('p')
    expect(store.todoList.map((t) => t.id)).toEqual(['x'])
  })

  it('刪除父項可復原，子任務一起回來', async () => {
    const store = setup()
    await store.init()
    store.todoList = [
      makeTask('父', false, { id: 'p', order: 0 }),
      makeTask('子', false, { id: 'c', parentId: 'p', order: 1 }),
    ]

    store.removeTask('p')
    expect(store.todoList).toHaveLength(0)

    await store.undo()
    expect(store.todoList.map((t) => t.id).sort()).toEqual(['c', 'p'])
  })
})

describe('刪除專案', () => {
  it('預設把任務移到未分類，而不是一起刪掉', async () => {
    const store = setup()
    await store.init()
    const project = store.addProject('工作')
    store.todoList = [
      makeTask('屬於工作', false, { id: 't1', projectId: project.id }),
      makeTask('沒有專案', false, { id: 't2' }),
    ]

    store.removeProject(project.id)

    expect(store.projects).toHaveLength(0)
    expect(store.todoList.map((t) => t.id), '任務不該被帶走').toEqual(['t1', 't2'])
    expect(store.todoList[0]?.projectId).toBeNull()
  })

  it('明確指定時才連任務一起刪', async () => {
    const store = setup()
    await store.init()
    const project = store.addProject('工作')
    store.todoList = [
      makeTask('屬於工作', false, { id: 't1', projectId: project.id }),
      makeTask('沒有專案', false, { id: 't2' }),
    ]

    store.removeProject(project.id, { deleteTasks: true })
    expect(store.todoList.map((t) => t.id)).toEqual(['t2'])
  })

  it('移至未分類的動作可復原', async () => {
    const store = setup()
    await store.init()
    const project = store.addProject('工作')
    store.todoList = [makeTask('屬於工作', false, { id: 't1', projectId: project.id })]

    store.removeProject(project.id)
    expect(store.todoList[0]?.projectId).toBeNull()

    await store.undo()
    expect(store.projects).toHaveLength(1)
    expect(store.todoList[0]?.projectId).toBe(project.id)
  })
})

describe('刪除標籤', () => {
  it('一併從所有任務身上移除，不留下指向不存在標籤的 id', async () => {
    const store = setup()
    await store.init()
    const tag = store.addTag('緊急')
    store.todoList = [
      makeTask('有標籤', false, { id: 't1', tagIds: [tag.id] }),
      makeTask('也有標籤', false, { id: 't2', tagIds: [tag.id, 'other'] }),
    ]

    store.removeTag(tag.id)

    expect(store.tags).toHaveLength(0)
    expect(store.todoList[0]?.tagIds).toEqual([])
    expect(store.todoList[1]?.tagIds, '其他標籤不受影響').toEqual(['other'])
  })

  it('可復原，標籤與關聯一起回來', async () => {
    const store = setup()
    await store.init()
    const tag = store.addTag('緊急')
    store.todoList = [makeTask('有標籤', false, { id: 't1', tagIds: [tag.id] })]

    store.removeTag(tag.id)
    await store.undo()

    expect(store.tags).toHaveLength(1)
    expect(store.todoList[0]?.tagIds).toEqual([tag.id])
  })
})

describe('重複性任務', () => {
  it('完成時把到期日推進到下一次，且維持未完成', async () => {
    const store = setup()
    await store.init()
    store.todoList = [
      makeTask('每天要做', false, { id: 'r', dueDate: '2030-01-01', recurrence: daily() }),
    ]

    store.toggleCompleted('r')

    expect(store.todoList[0]?.dueDate, '推進到下一次').toBe('2030-01-02')
    expect(store.todoList[0]?.isCompleted, '仍是未完成').toBe(false)
  })

  it('規則結束後才真正標記完成', async () => {
    const store = setup()
    await store.init()
    store.todoList = [
      makeTask('最後一次', false, {
        id: 'r',
        dueDate: '2030-01-01',
        recurrence: daily({ until: '2030-01-01' }),
      }),
    ]

    store.toggleCompleted('r')
    expect(store.todoList[0]?.isCompleted).toBe(true)
    expect(store.todoList[0]?.dueDate).toBe('2030-01-01')
  })

  it('沒有到期日的重複任務照一般方式完成', async () => {
    const store = setup()
    await store.init()
    store.todoList = [makeTask('沒設日期', false, { id: 'r', recurrence: daily() })]

    store.toggleCompleted('r')
    expect(store.todoList[0]?.isCompleted).toBe(true)
  })

  it('推進後可復原回原本的到期日', async () => {
    const store = setup()
    await store.init()
    store.todoList = [
      makeTask('可復原', false, { id: 'r', dueDate: '2030-01-01', recurrence: daily() }),
    ]

    store.toggleCompleted('r')
    expect(store.todoList[0]?.dueDate).toBe('2030-01-02')

    await store.undo()
    expect(store.todoList[0]?.dueDate).toBe('2030-01-01')
  })

  it('每週規則依 byDay 推進', async () => {
    const store = setup()
    await store.init()
    // 2030-01-01 是星期二
    store.todoList = [
      makeTask('每週一四', false, {
        id: 'r',
        dueDate: '2030-01-01',
        recurrence: daily({ freq: 'weekly', byDay: ['MO', 'TH'] }),
      }),
    ]

    store.toggleCompleted('r')
    expect(store.todoList[0]?.dueDate).toBe('2030-01-03')
  })
})

describe('moveTask 排序', () => {
  const seed = (store: ReturnType<typeof useTodoTaskStore>) => {
    store.todoList = [
      makeTask('甲', false, { id: 'a', order: 0 }),
      makeTask('乙', false, { id: 'b', order: 10 }),
      makeTask('丙', false, { id: 'c', order: 20 }),
    ]
  }
  const idsByOrder = (store: ReturnType<typeof useTodoTaskStore>) =>
    [...store.todoList].sort((x, y) => x.order - y.order).map((t) => t.id)

  it('移到目標之前', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('c', 'b', 'before')
    expect(idsByOrder(store)).toEqual(['a', 'c', 'b'])
  })

  it('移到目標之後', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('a', 'b', 'after')
    expect(idsByOrder(store)).toEqual(['b', 'a', 'c'])
  })

  it('只改動被移動的那一列，其餘排序鍵不變', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('c', 'a', 'after')

    expect(store.todoList.find((t) => t.id === 'a')?.order, '未被移動').toBe(0)
    expect(store.todoList.find((t) => t.id === 'b')?.order, '未被移動').toBe(10)
    expect(store.todoList.find((t) => t.id === 'c')?.order, '取中間值').toBe(5)
  })

  it('移到最前面', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('c', 'a', 'before')
    expect(idsByOrder(store)).toEqual(['c', 'a', 'b'])
  })

  it('移到最後面', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('a', 'c', 'after')
    expect(idsByOrder(store)).toEqual(['b', 'c', 'a'])
  })

  it('移動可復原', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('b', 'a', 'before')
    await store.undo()
    expect(store.todoList.find((t) => t.id === 'b')?.order).toBe(10)
  })

  it('移到自己身上是 no-op', async () => {
    const store = setup()
    await store.init()
    seed(store)

    store.moveTask('a', 'a', 'before')
    expect(store.todoList.find((t) => t.id === 'a')?.order).toBe(0)
  })
})
