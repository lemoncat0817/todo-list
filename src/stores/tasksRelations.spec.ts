import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import * as db from '@/db'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useHistoryStore } from '@/stores/history'
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
  return { tasks: useTasksStore(), collections: useCollectionsStore(), history: useHistoryStore() }
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
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [
      makeTask('父', false, { id: 'p', order: 0 }),
      makeTask('子一', false, { id: 'c1', parentId: 'p', order: 1 }),
      makeTask('子二', false, { id: 'c2', parentId: 'p', order: 2 }),
      makeTask('不相干', false, { id: 'x', order: 3 }),
    ]

    app.tasks.remove('p')
    expect(app.tasks.items.map((t) => t.id)).toEqual(['x'])
  })

  it('刪除父項可復原，子任務一起回來', async () => {
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [
      makeTask('父', false, { id: 'p', order: 0 }),
      makeTask('子', false, { id: 'c', parentId: 'p', order: 1 }),
    ]

    app.tasks.remove('p')
    expect(app.tasks.items).toHaveLength(0)

    await app.history.undo()
    expect(app.tasks.items.map((t) => t.id).sort()).toEqual(['c', 'p'])
  })
})

describe('刪除專案', () => {
  it('預設把任務移到未分類，而不是一起刪掉', async () => {
    const app = setup()
    await app.tasks.init()
    const project = app.collections.addProject('工作')
    app.tasks.items = [
      makeTask('屬於工作', false, { id: 't1', projectId: project.id }),
      makeTask('沒有專案', false, { id: 't2' }),
    ]

    app.tasks.removeProject(project.id)

    expect(app.collections.projects).toHaveLength(0)
    expect(app.tasks.items.map((t) => t.id), '任務不該被帶走').toEqual(['t1', 't2'])
    expect(app.tasks.items[0]?.projectId).toBeNull()
  })

  it('明確指定時才連任務一起刪', async () => {
    const app = setup()
    await app.tasks.init()
    const project = app.collections.addProject('工作')
    app.tasks.items = [
      makeTask('屬於工作', false, { id: 't1', projectId: project.id }),
      makeTask('沒有專案', false, { id: 't2' }),
    ]

    app.tasks.removeProject(project.id, { deleteTasks: true })
    expect(app.tasks.items.map((t) => t.id)).toEqual(['t2'])
  })

  it('移至未分類的動作可復原', async () => {
    const app = setup()
    await app.tasks.init()
    const project = app.collections.addProject('工作')
    app.tasks.items = [makeTask('屬於工作', false, { id: 't1', projectId: project.id })]

    app.tasks.removeProject(project.id)
    expect(app.tasks.items[0]?.projectId).toBeNull()

    await app.history.undo()
    expect(app.collections.projects).toHaveLength(1)
    expect(app.tasks.items[0]?.projectId).toBe(project.id)
  })
})

describe('刪除標籤', () => {
  it('一併從所有任務身上移除，不留下指向不存在標籤的 id', async () => {
    const app = setup()
    await app.tasks.init()
    const tag = app.collections.addTag('緊急')
    app.tasks.items = [
      makeTask('有標籤', false, { id: 't1', tagIds: [tag.id] }),
      makeTask('也有標籤', false, { id: 't2', tagIds: [tag.id, 'other'] }),
    ]

    app.tasks.removeTag(tag.id)

    expect(app.collections.tags).toHaveLength(0)
    expect(app.tasks.items[0]?.tagIds).toEqual([])
    expect(app.tasks.items[1]?.tagIds, '其他標籤不受影響').toEqual(['other'])
  })

  it('可復原，標籤與關聯一起回來', async () => {
    const app = setup()
    await app.tasks.init()
    const tag = app.collections.addTag('緊急')
    app.tasks.items = [makeTask('有標籤', false, { id: 't1', tagIds: [tag.id] })]

    app.tasks.removeTag(tag.id)
    await app.history.undo()

    expect(app.collections.tags).toHaveLength(1)
    expect(app.tasks.items[0]?.tagIds).toEqual([tag.id])
  })
})

describe('重複性任務', () => {
  it('完成時把到期日推進到下一次，且維持未完成', async () => {
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [
      makeTask('每天要做', false, { id: 'r', dueDate: '2030-01-01', recurrence: daily() }),
    ]

    app.tasks.toggle('r')

    expect(app.tasks.items[0]?.dueDate, '推進到下一次').toBe('2030-01-02')
    expect(app.tasks.items[0]?.isCompleted, '仍是未完成').toBe(false)
  })

  it('規則結束後才真正標記完成', async () => {
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [
      makeTask('最後一次', false, {
        id: 'r',
        dueDate: '2030-01-01',
        recurrence: daily({ until: '2030-01-01' }),
      }),
    ]

    app.tasks.toggle('r')
    expect(app.tasks.items[0]?.isCompleted).toBe(true)
    expect(app.tasks.items[0]?.dueDate).toBe('2030-01-01')
  })

  it('沒有到期日的重複任務照一般方式完成', async () => {
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [makeTask('沒設日期', false, { id: 'r', recurrence: daily() })]

    app.tasks.toggle('r')
    expect(app.tasks.items[0]?.isCompleted).toBe(true)
  })

  it('推進後可復原回原本的到期日', async () => {
    const app = setup()
    await app.tasks.init()
    app.tasks.items = [
      makeTask('可復原', false, { id: 'r', dueDate: '2030-01-01', recurrence: daily() }),
    ]

    app.tasks.toggle('r')
    expect(app.tasks.items[0]?.dueDate).toBe('2030-01-02')

    await app.history.undo()
    expect(app.tasks.items[0]?.dueDate).toBe('2030-01-01')
  })

  it('每週規則依 byDay 推進', async () => {
    const app = setup()
    await app.tasks.init()
    // 2030-01-01 是星期二
    app.tasks.items = [
      makeTask('每週一四', false, {
        id: 'r',
        dueDate: '2030-01-01',
        recurrence: daily({ freq: 'weekly', byDay: ['MO', 'TH'] }),
      }),
    ]

    app.tasks.toggle('r')
    expect(app.tasks.items[0]?.dueDate).toBe('2030-01-03')
  })
})

describe('moveTask 排序', () => {
  const seed = (store: ReturnType<typeof useTasksStore>) => {
    store.items = [
      makeTask('甲', false, { id: 'a', order: 0 }),
      makeTask('乙', false, { id: 'b', order: 10 }),
      makeTask('丙', false, { id: 'c', order: 20 }),
    ]
  }
  const idsByOrder = (store: ReturnType<typeof useTasksStore>) =>
    [...store.items].sort((x, y) => x.order - y.order).map((t) => t.id)

  it('移到目標之前', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('c', 'b', 'before')
    expect(idsByOrder(app.tasks)).toEqual(['a', 'c', 'b'])
  })

  it('移到目標之後', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('a', 'b', 'after')
    expect(idsByOrder(app.tasks)).toEqual(['b', 'a', 'c'])
  })

  it('只改動被移動的那一列，其餘排序鍵不變', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('c', 'a', 'after')

    expect(app.tasks.items.find((t) => t.id === 'a')?.order, '未被移動').toBe(0)
    expect(app.tasks.items.find((t) => t.id === 'b')?.order, '未被移動').toBe(10)
    expect(app.tasks.items.find((t) => t.id === 'c')?.order, '取中間值').toBe(5)
  })

  it('移到最前面', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('c', 'a', 'before')
    expect(idsByOrder(app.tasks)).toEqual(['c', 'a', 'b'])
  })

  it('移到最後面', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('a', 'c', 'after')
    expect(idsByOrder(app.tasks)).toEqual(['b', 'c', 'a'])
  })

  it('移動可復原', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('b', 'a', 'before')
    await app.history.undo()
    expect(app.tasks.items.find((t) => t.id === 'b')?.order).toBe(10)
  })

  it('移到自己身上是 no-op', async () => {
    const app = setup()
    await app.tasks.init()
    seed(app.tasks)

    app.tasks.move('a', 'a', 'before')
    expect(app.tasks.items.find((t) => t.id === 'a')?.order).toBe(0)
  })
})

describe('持久化 watcher 涵蓋所有會被存的狀態', () => {
  /**
   * filters 曾經漏在 tasks.ts 的 watch 依賴清單外：單獨新增一個篩選器
   * 不會觸發 flush()，得等任務或專案／標籤也剛好變動才連帶存進去。
   */
  afterEach(() => vi.restoreAllMocks())

  it('單獨新增一個篩選器也會觸發存檔，不需要搭配任務變動', async () => {
    const app = setup()
    await app.tasks.init()
    const spy = vi.spyOn(db, 'saveFilters')

    app.collections.addFilter('要事', 'today & p1')
    await nextTick()
    await app.tasks.flush()

    expect(spy).toHaveBeenCalled()
    const lastCall = spy.mock.calls.at(-1)
    expect(lastCall?.[0]).toHaveLength(1)
  })
})
