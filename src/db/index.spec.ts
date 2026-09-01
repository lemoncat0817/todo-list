import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  getDB,
  resetDBCache,
  loadTasks,
  saveTasks,
  getMeta,
  setMeta,
  migrateFromLocalStorage,
} from '@/db'
import { nextOrder, orderBetween } from '@/domain/ordering'
import { META_MIGRATED_FROM_LOCALSTORAGE, STORE_TASKS, type StoredTask } from '@/db/schema'
import { makeTask } from '@/test/helpers'

/** 每個測試都用全新的 IndexedDB，避免互相汙染。 */
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDBCache()
  localStorage.clear()
})

const task = (id: string, name: string, done = false, order = 0): StoredTask =>
  makeTask(name, done, { id, order })

describe('IndexedDB 資料層', () => {
  it('建立時就備妥五個 object store 與排序索引', async () => {
    const db = await getDB()
    expect([...db.objectStoreNames].sort()).toEqual([
      'filters',
      'meta',
      'projects',
      'tags',
      'tasks',
    ])

    const tx = db.transaction(STORE_TASKS)
    expect([...tx.store.indexNames]).toContain('by-order')
  })

  it('存進去再讀出來，內容一致', async () => {
    const rows = [task('a', '買牛奶', false, 0), task('b', '寫測試', true, 1)]
    await saveTasks(rows)
    expect(await loadTasks()).toEqual(rows)
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

  describe('orderBetween —— 拖曳排序只需改動一列', () => {
    it('兩者之間取中間值', () => {
      expect(orderBetween(1, 2)).toBe(1.5)
      expect(orderBetween(0, 10)).toBe(5)
    })
    it('移到最前面時取比後者小的值', () => {
      expect(orderBetween(null, 5)).toBeLessThan(5)
    })
    it('移到最後面時取比前者大的值', () => {
      expect(orderBetween(5, null)).toBeGreaterThan(5)
    })
    it('清單為空時回 0', () => {
      expect(orderBetween(null, null)).toBe(0)
    })
    it('連續插入同一位置仍保持嚴格遞增', () => {
      let lo = 0
      const hi = 1
      for (let i = 0; i < 10; i++) {
        const mid = orderBetween(lo, hi)
        expect(mid).toBeGreaterThan(lo)
        expect(mid).toBeLessThan(hi)
        lo = mid
      }
    })
  })

  describe('nextOrder', () => {
    it('空清單從 0 開始', () => {
      expect(nextOrder([])).toBe(0)
    })
    it('接在最大值之後', () => {
      expect(nextOrder([task('a', 'x', false, 3), task('b', 'y', false, 7)])).toBe(8)
    })
    it('不受插入順序影響', () => {
      expect(nextOrder([task('b', 'y', false, 7), task('a', 'x', false, 3)])).toBe(8)
    })
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

  it('數字 id 轉成字串，order 依原順序給定', async () => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({ todoList: [{ id: 1700000000000, taskName: 'x', isCompleted: false }] }),
    )
    await migrateFromLocalStorage()

    const rows = await loadTasks()
    expect(rows[0]?.id).toBe('1700000000000')
    expect(typeof rows[0]?.id).toBe('string')
    expect(rows[0]?.order).toBe(0)
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
