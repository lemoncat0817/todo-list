import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import {
  getDB,
  resetDBCache,
  loadTasks,
  loadProjects,
  loadFilters,
  loadComments,
  saveTasks,
  saveComments,
  getMeta,
  setMeta,
  migrateFromLocalStorage,
  loadOutbox,
  enqueueOp,
  removeOp,
  markOpAttempt,
  clearOutbox,
} from '@/db'
// between()／nextRank()（取代原本這裡測的 orderBetween／nextOrder）
// 的測試在 domain/rank.spec.ts，不在這裡重複。
import {
  DB_NAME,
  META_MIGRATED_FROM_LOCALSTORAGE,
  STORE_FILTERS,
  STORE_META,
  STORE_PROJECTS,
  STORE_TAGS,
  STORE_TASKS,
  type Op,
  type StoredTask,
} from '@/db/schema'
import { makeTask } from '@/test/helpers'
import { nextRank } from '@/domain/rank'

/** 每個測試都用全新的 IndexedDB，避免互相汙染。 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDBCache()
  localStorage.clear()
})

const task = (id: string, name: string, done = false, order = 0): StoredTask =>
  makeTask(name, done, { id, order })

describe('IndexedDB 資料層', () => {
  it('建立時就備妥七個 object store 與排序索引', async () => {
    const db = await getDB()
    expect([...db.objectStoreNames].sort()).toEqual([
      'comments',
      'filters',
      'meta',
      'outbox',
      'projects',
      'tags',
      'tasks',
    ])

    const tx = db.transaction(STORE_TASKS)
    expect([...tx.store.indexNames]).toContain('by-rank')
  })

  it('存進去再讀出來，內容一致', async () => {
    const rows = [task('a', '買牛奶', false, 0), task('b', '寫測試', true, 1)]
    await saveTasks(rows)
    expect(await loadTasks()).toEqual(rows)
  })

  it('留言存進去再讀出來，依 createdAt 排序', async () => {
    const rows = [
      { id: 'c2', taskId: 't1', authorId: 'u1', body: '第二則', mentionedUserIds: [], createdAt: 200, updatedAt: 200 },
      { id: 'c1', taskId: 't1', authorId: 'u1', body: '第一則', mentionedUserIds: [], createdAt: 100, updatedAt: 100 },
    ]
    await saveComments(rows)
    expect((await loadComments()).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('讀出時依 order 排序，而非插入順序', async () => {
    await saveTasks([task('c', '第三', false, 30), task('a', '第一', false, 10), task('b', '第二', false, 20)])
    expect((await loadTasks()).map((t) => t.taskName)).toEqual(['第一', '第二', '第三'])
  })

  it('order 支援插值，可在兩筆之間插入而不重寫整份清單', async () => {
    await saveTasks([task('a', '前', false, 1), task('b', '後', false, 2)])
    const db = await getDB()
    await db.put(STORE_TASKS, task('mid', '中間', false, 1.5))

    expect((await loadTasks()).map((t) => t.taskName)).toEqual(['前', '中間', '後'])
  })

  it('saveTasks 是覆寫語意，不會殘留舊列', async () => {
    await saveTasks([task('a', '舊的一', false, 0), task('b', '舊的二', false, 1)])
    await saveTasks([task('c', '新的', false, 0)])

    expect((await loadTasks()).map((t) => t.id)).toEqual(['c'])
  })

  it('略過形狀壞掉的列，而不是讓整批讀取失敗', async () => {
    const db = await getDB()
    await db.put(STORE_TASKS, task('good', '正常', false, 0))
    // 繞過型別直接塞入壞資料，模擬外部寫入或版本不一致
    await db.put(STORE_TASKS, { id: 'bad', taskName: 123, isCompleted: 'yes', order: 1 } as never)
    await db.put(STORE_TASKS, { id: 'bad2', order: 2 } as never)

    const rows = await loadTasks()
    expect(rows.map((t) => t.id)).toEqual(['good'])
  })

  it('meta 可讀寫任意值', async () => {
    expect(await getMeta('nope')).toBeUndefined()
    await setMeta('answer', 42)
    expect(await getMeta<number>('answer')).toBe(42)
  })

  describe('outbox —— 離線操作佇列', () => {
    const op = (id: string, createdAt: number, attempts = 0): Op => ({
      id,
      kind: 'task.patch',
      targetId: 'task-1',
      payload: { notes: id },
      createdAt,
      attempts,
    })

    it('依 createdAt 依序讀出，不是插入順序', async () => {
      await enqueueOp(op('c', 30))
      await enqueueOp(op('a', 10))
      await enqueueOp(op('b', 20))

      expect((await loadOutbox()).map((o) => o.id)).toEqual(['a', 'b', 'c'])
    })

    it('removeOp 送達後從佇列移除，其餘不受影響', async () => {
      await enqueueOp(op('a', 10))
      await enqueueOp(op('b', 20))
      await removeOp('a')

      expect((await loadOutbox()).map((o) => o.id)).toEqual(['b'])
    })

    it('clearOutbox 清空整個佇列——換帳號時用，上一個帳號還沒送出的操作不該用新身分送出', async () => {
      await enqueueOp(op('a', 10))
      await enqueueOp(op('b', 20))
      await clearOutbox()

      expect(await loadOutbox()).toEqual([])
    })

    it('markOpAttempt 只累加次數，不動其他欄位', async () => {
      await enqueueOp(op('a', 10))
      await markOpAttempt('a')
      await markOpAttempt('a')

      const [row] = await loadOutbox()
      expect(row?.attempts).toBe(2)
      expect(row?.payload).toEqual({ notes: 'a' })
    })

    it('對不存在的 id 呼叫 markOpAttempt 不會拋出', async () => {
      await expect(markOpAttempt('missing')).resolves.toBeUndefined()
    })

    it('略過形狀壞掉的列，不讓上傳器整批卡住', async () => {
      const db = await getDB()
      await db.put('outbox', op('good', 10))
      await db.put('outbox', { id: 'bad', createdAt: 20 } as never) // 缺 kind/targetId

      expect((await loadOutbox()).map((o) => o.id)).toEqual(['good'])
    })
  })

})

/**
 * v4 → v5 的 upgrade()：既有使用者的 order（浮點數）換算成 rank（字串），
 * 索引從 by-order 換成 by-rank。這是這次改動裡風險最高、也最沒有機會
 * 「跑錯了會馬上發現」的一段——沒有這個測試的話，前面 41 個測試檔案
 * 全部都是從 v5 全新建立資料庫開始，完全沒有真正走過這條升級路徑。
 */
describe('v4 → v5：order 換算成 rank', () => {
  async function seedV4Database(): Promise<void> {
    const db = await openDB(DB_NAME, 4, {
      upgrade(db) {
        const tasks = db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
        tasks.createIndex('by-order', 'order')
        db.createObjectStore(STORE_META)
        const projects = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
        projects.createIndex('by-order', 'order')
        db.createObjectStore(STORE_TAGS, { keyPath: 'id' })
        const filters = db.createObjectStore(STORE_FILTERS, { keyPath: 'id' })
        filters.createIndex('by-order', 'order')
        db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('by-createdAt', 'createdAt')
      },
    })

    // 刻意亂序寫入：升級後的相對順序要看 order 的值，不是寫入順序。
    await db.put(STORE_TASKS, { id: 't-c', taskName: '丙', isCompleted: false, order: 20, notes: '', priority: 0, dueDate: null, dueTime: null, projectId: null, tagIds: [], parentId: null, recurrence: null, completedAt: null, createdAt: 1, updatedAt: 1 })
    await db.put(STORE_TASKS, { id: 't-a', taskName: '甲', isCompleted: false, order: 0, notes: '', priority: 0, dueDate: null, dueTime: null, projectId: null, tagIds: [], parentId: null, recurrence: null, completedAt: null, createdAt: 1, updatedAt: 1 })
    await db.put(STORE_TASKS, { id: 't-b', taskName: '乙', isCompleted: false, order: 10, notes: '', priority: 0, dueDate: null, dueTime: null, projectId: null, tagIds: [], parentId: null, recurrence: null, completedAt: null, createdAt: 1, updatedAt: 1 })

    await db.put(STORE_PROJECTS, { id: 'p-b', name: '專案乙', color: '#000', order: 1, updatedAt: 1 })
    await db.put(STORE_PROJECTS, { id: 'p-a', name: '專案甲', color: '#000', order: 0, updatedAt: 1 })

    await db.put(STORE_FILTERS, { id: 'f-a', name: '篩選甲', query: 'today', color: '#000', order: 0, updatedAt: 1 })

    db.close()
  }

  it('升級後 rank 保留原本的相對順序，order 欄位不再出現', async () => {
    await seedV4Database()
    resetDBCache()

    const tasks = await loadTasks()
    expect(tasks.map((t) => t.taskName)).toEqual(['甲', '乙', '丙'])
    for (const t of tasks) {
      expect(typeof t.rank).toBe('string')
      expect(t.rank.length).toBeGreaterThan(0)
      expect(t as unknown as Record<string, unknown>).not.toHaveProperty('order')
    }
    // rank 本身也要跟 loadTasks() 讀出的順序一致（by-rank 索引排序正確）
    const ranks = tasks.map((t) => t.rank)
    expect(ranks).toEqual([...ranks].sort())

    const projects = await loadProjects()
    expect(projects.map((p) => p.name)).toEqual(['專案甲', '專案乙'])

    const filters = await loadFilters()
    expect(filters.map((f) => f.name)).toEqual(['篩選甲'])
    expect(typeof filters[0]?.rank).toBe('string')
  })

  it('升級後可以正常新增任務，新任務排在最後面', async () => {
    await seedV4Database()
    resetDBCache()

    const before = await loadTasks()
    const newTask = { ...makeTask('丁'), rank: nextRank(before) }
    await saveTasks([...before, newTask])

    const after = await loadTasks()
    expect(after.map((t) => t.taskName)).toEqual(['甲', '乙', '丙', '丁'])
  })
})

describe('從 localStorage 遷移', () => {
  it('把舊資料搬進 IndexedDB 並標記完成', async () => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({
        todoList: [
          { id: 1, taskName: '舊資料一', isCompleted: false },
          { id: 2, taskName: '舊資料二', isCompleted: true },
        ],
      }),
    )

    const result = await migrateFromLocalStorage()
    expect(result).toEqual({ ran: true, migrated: 2, skipped: 0 })

    const rows = await loadTasks()
    expect(rows.map((t) => t.taskName)).toEqual(['舊資料一', '舊資料二'])
    expect(rows.map((t) => t.isCompleted)).toEqual([false, true])
    expect(await getMeta<boolean>(META_MIGRATED_FROM_LOCALSTORAGE)).toBe(true)
  })

  it('數字 id 轉成字串，rank 給一個合法的值', async () => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({ todoList: [{ id: 1700000000000, taskName: 'x', isCompleted: false }] }),
    )
    await migrateFromLocalStorage()

    const rows = await loadTasks()
    expect(rows[0]?.id).toBe('1700000000000')
    expect(typeof rows[0]?.id).toBe('string')
    expect(typeof rows[0]?.rank).toBe('string')
    expect(rows[0]?.rank.length).toBeGreaterThan(0)
  })

  it('壞掉的項目被跳過並計數，好的照樣搬過去', async () => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({
        todoList: [
          { id: 1, taskName: '有效', isCompleted: false },
          null,
          { id: 2, taskName: 99 },
          { taskName: '沒有 id' },
        ],
      }),
    )

    const result = await migrateFromLocalStorage()
    expect(result.migrated).toBe(1)
    expect(result.skipped).toBe(3)
    expect((await loadTasks()).map((t) => t.taskName)).toEqual(['有效'])
  })

  it('第二次呼叫不會重複遷移', async () => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({ todoList: [{ id: 1, taskName: 'x', isCompleted: false }] }),
    )
    await migrateFromLocalStorage()

    // 使用者在遷移後又動了資料，再開一次不該被舊的 localStorage 覆蓋
    await saveTasks([task('new', '遷移後新增的', false, 0)])
    const second = await migrateFromLocalStorage()

    expect(second).toEqual({ ran: false, migrated: 0, skipped: 0 })
    expect((await loadTasks()).map((t) => t.taskName)).toEqual(['遷移後新增的'])
  })

  it('沒有舊資料時直接標記完成', async () => {
    const result = await migrateFromLocalStorage()
    expect(result).toEqual({ ran: false, migrated: 0, skipped: 0 })
    expect(await getMeta<boolean>(META_MIGRATED_FROM_LOCALSTORAGE)).toBe(true)
  })

  it('JSON 語法錯誤不會拋出，也不會卡在每次重試', async () => {
    localStorage.setItem('todoTask', '{todoList: [}')

    await expect(migrateFromLocalStorage()).resolves.toEqual({ ran: true, migrated: 0, skipped: 0 })
    expect(await getMeta<boolean>(META_MIGRATED_FROM_LOCALSTORAGE)).toBe(true)
  })

  it('不刪除 localStorage 原始資料，保留回滾舊版的可能', async () => {
    const original = JSON.stringify({ todoList: [{ id: 1, taskName: 'x', isCompleted: false }] })
    localStorage.setItem('todoTask', original)
    await migrateFromLocalStorage()

    expect(localStorage.getItem('todoTask')).toBe(original)
  })
})
