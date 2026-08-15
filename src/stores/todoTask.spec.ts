import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTodoTaskStore } from '@/stores/todoTask'
import * as db from '@/db'
import { makeTask } from '@/test/helpers'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useTodoTaskStore()
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('todoTask store', () => {
  describe('init', () => {
    it('從 IndexedDB 載入任務並解除載入中狀態', async () => {
      await db.saveTasks([
        makeTask('已存在的', false, { id: 'a', order: 0 }),
        makeTask('第二筆', true, { id: 'b', order: 1 }),
      ])

      const store = setup()
      expect(store.isLoading, '初始應為載入中').toBe(true)

      await store.init()

      expect(store.isLoading).toBe(false)
      expect(store.todoList.map((t) => t.taskName)).toEqual(['已存在的', '第二筆'])
      expect(store.loadError).toBeNull()
    })

    it('啟動時執行一次性遷移，並記錄結果', async () => {
      localStorage.setItem(
        'todoTask',
        JSON.stringify({
          todoList: [
            { id: 1, taskName: '舊資料', isCompleted: false },
            { id: 2, taskName: 123 },
          ],
        }),
      )

      const store = setup()
      await store.init()

      expect(store.todoList.map((t) => t.taskName)).toEqual(['舊資料'])
      expect(store.migration).toEqual({ migrated: 1, skipped: 1 })
    })

    it('載入失敗時設定 loadError 且不再停留在載入中', async () => {
      vi.spyOn(db, 'loadTasks').mockRejectedValue(new Error('IDB 掛了'))

      const store = setup()
      await store.init()

      expect(store.isLoading).toBe(false)
      expect((store.loadError as Error).message).toBe('IDB 掛了')
    })
  })

  describe('寫入失敗與載入失敗必須分開', () => {
    it('寫入失敗只設定 writeError，清單內容原封不動', async () => {
      const store = setup()
      await store.init()

      vi.spyOn(db, 'saveTasks').mockRejectedValue(new Error('配額已滿'))
      store.addTask('存不進去但要看得到')
      await nextTick()
      await store.flush()

      expect((store.writeError as Error).message).toBe('配額已滿')
      expect(store.loadError, '寫入失敗不該影響載入狀態').toBeNull()
      expect(store.todoList.map((t) => t.taskName)).toEqual(['存不進去但要看得到'])
    })

    it('下一次寫入成功時清掉 writeError', async () => {
      const store = setup()
      await store.init()

      const spy = vi.spyOn(db, 'saveTasks').mockRejectedValueOnce(new Error('暫時失敗'))
      store.addTask('第一次')
      await nextTick()
      await store.flush()
      expect(store.writeError).not.toBeNull()

      spy.mockRestore()
      store.addTask('第二次')
      await nextTick()
      await store.flush()
      expect(store.writeError).toBeNull()
    })
  })

  describe('變更會落地到 IndexedDB', () => {
    it('新增後可從 IndexedDB 讀回', async () => {
      const store = setup()
      await store.init()

      store.addTask('要存下去的')
      await nextTick()
      await store.flush()

      expect((await db.loadTasks()).map((t) => t.taskName)).toEqual(['要存下去的'])
    })

    it('刪除後 IndexedDB 也不再有該筆', async () => {
      const store = setup()
      await store.init()
      const task = store.addTask('待刪除')
      await nextTick()
      await store.flush()

      store.removeTask(task.id)
      await nextTick()
      await store.flush()

      expect(await db.loadTasks()).toEqual([])
    })

    it('清除已完成只移除已完成的', async () => {
      const store = setup()
      await store.init()
      store.todoList = [
        makeTask('留著', false, { id: 'keep', order: 0 }),
        makeTask('清掉', true, { id: 'gone', order: 1 }),
      ]
      await nextTick()

      store.clearCompleted()
      await nextTick()
      await store.flush()

      expect((await db.loadTasks()).map((t) => t.id)).toEqual(['keep'])
    })

    it('全選 / 全取消一次改動所有項目', async () => {
      const store = setup()
      await store.init()
      store.todoList = [makeTask('a', false, { order: 0 }), makeTask('b', false, { order: 1 })]

      store.setAllCompleted(true)
      expect(store.todoList.every((t) => t.isCompleted)).toBe(true)

      store.setAllCompleted(false)
      expect(store.todoList.every((t) => !t.isCompleted)).toBe(true)
    })
  })

  describe('addTask', () => {
    it('產生 UUID 形狀的 id（稽核 P17）', async () => {
      const store = setup()
      await store.init()

      const task = store.addTask('x')
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })

    it('排序鍵接續在現有最大值之後', async () => {
      const store = setup()
      await store.init()
      store.todoList = [makeTask('既有', false, { order: 5 })]

      expect(store.addTask('新的').order).toBe(6)
    })
  })

  describe('載入期間不回寫', () => {
    it('init 尚未完成時的初始空陣列不會覆蓋既有資料', async () => {
      await db.saveTasks([makeTask('不可以不見', false, { id: 'a', order: 0 })])
      const spy = vi.spyOn(db, 'saveTasks')

      const store = setup()
      await store.init()
      await nextTick()

      expect(spy, '載入流程本身不應觸發寫入').not.toHaveBeenCalled()
      expect(store.todoList.map((t) => t.taskName)).toEqual(['不可以不見'])
    })
  })
})
