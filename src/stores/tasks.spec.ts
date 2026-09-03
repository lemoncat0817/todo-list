import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createApp, nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import * as db from '@/db'
import { at, freshPinia, makeTask, becomeWorkspaceMember } from '@/test/helpers'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCollectionsStore } from '@/stores/collections'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useTasksStore()
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
      expect(store.items.map((t) => t.taskName)).toEqual(['已存在的', '第二筆'])
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

      expect(store.items.map((t) => t.taskName)).toEqual(['舊資料'])
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

      vi.spyOn(db, 'applyTaskChanges').mockRejectedValue(new Error('配額已滿'))
      store.add('存不進去但要看得到')
      await nextTick()
      await store.flush()

      expect((store.writeError as Error).message).toBe('配額已滿')
      expect(store.loadError, '寫入失敗不該影響載入狀態').toBeNull()
      expect(store.items.map((t) => t.taskName)).toEqual(['存不進去但要看得到'])
    })

    it('下一次寫入成功時清掉 writeError', async () => {
      const store = setup()
      await store.init()

      const spy = vi.spyOn(db, 'applyTaskChanges').mockRejectedValueOnce(new Error('暫時失敗'))
      store.add('第一次')
      await nextTick()
      await store.flush()
      expect(store.writeError).not.toBeNull()

      spy.mockRestore()
      store.add('第二次')
      await nextTick()
      await store.flush()
      expect(store.writeError).toBeNull()
    })

    /**
     * 實測回歸：TaskDetailForm 的 draft 是一個 ref，讀出來的巢狀物件
     * （這裡是 recurrence）會是 Vue 的 reactive Proxy，不是純物件。
     * 過去 snapshot() 只淺層 toRaw，Proxy 會一路帶到 IndexedDB 的
     * put()，觸發瀏覽器真實丟出的 DataCloneError——不是配額問題，
     * 是巢狀物件沒被拆成純資料。這裡直接用 reactive() 模擬那個 Proxy，
     * 不 mock db 層，讓測試真的走到會失敗的那一段程式碼。
     */
    it('update() 傳入巢狀的 reactive proxy（例如 recurrence）也能正常寫入', async () => {
      const store = setup()
      await store.init()

      const task = store.add('會重複的任務')
      const proxiedRecurrence = reactive({
        freq: 'daily' as const,
        interval: 1,
        byDay: [],
        byMonthDay: null,
        until: null,
        count: null,
      })
      store.update(task.id, { dueDate: '2026-01-01', recurrence: proxiedRecurrence })
      await nextTick()
      await store.flush()

      expect(store.writeError, 'recurrence 帶著 reactive proxy 也不該寫入失敗').toBeNull()
      const persisted = (await db.loadTasks()).find((t) => t.id === task.id)
      expect(persisted?.recurrence).toEqual({
        freq: 'daily',
        interval: 1,
        byDay: [],
        byMonthDay: null,
        until: null,
        count: null,
      })
    })
  })

  describe('變更會落地到 IndexedDB', () => {
    it('新增後可從 IndexedDB 讀回', async () => {
      const store = setup()
      await store.init()

      store.add('要存下去的')
      await nextTick()
      await store.flush()

      expect((await db.loadTasks()).map((t) => t.taskName)).toEqual(['要存下去的'])
    })

    it('刪除後 IndexedDB 也不再有該筆', async () => {
      const store = setup()
      await store.init()
      const task = store.add('待刪除')
      await nextTick()
      await store.flush()

      store.remove(task.id)
      await nextTick()
      await store.flush()

      expect(await db.loadTasks()).toEqual([])
    })

    it('清除已完成只移除已完成的', async () => {
      const store = setup()
      await store.init()
      store.items = [
        makeTask('留著', false, { id: 'keep', order: 0 }),
        makeTask('清掉', true, { id: 'gone', order: 1 }),
      ]
      await nextTick()

      store.clearCompleted()
      await nextTick()
      await store.flush()

      expect((await db.loadTasks()).map((t) => t.id)).toEqual(['keep'])
    })
  })

  describe('batchComplete', () => {
    it('只改動被選中的項目，其餘不受影響', async () => {
      const store = setup()
      await store.init()
      store.items = [
        makeTask('a', false, { id: 'a', order: 0 }),
        makeTask('b', false, { id: 'b', order: 1 }),
      ]

      store.batchComplete(['a'], true)
      expect(store.items.find((t) => t.id === 'a')?.isCompleted).toBe(true)
      expect(store.items.find((t) => t.id === 'b')?.isCompleted).toBe(false)

      store.batchComplete(['a'], false)
      expect(store.items.find((t) => t.id === 'a')?.isCompleted).toBe(false)
    })

    it('一次批次操作只推一筆復原紀錄', async () => {
      const store = setup()
      const history = useHistoryStore()
      await store.init()
      store.items = [
        makeTask('a', false, { id: 'a', order: 0 }),
        makeTask('b', false, { id: 'b', order: 1 }),
      ]

      store.batchComplete(['a', 'b'], true)
      expect(history.depth).toBe(1)

      await history.undo()
      expect(store.items.every((t) => !t.isCompleted)).toBe(true)
    })

    it('有重複規則的任務完成時推進到下一次，而不是直接標記完成', async () => {
      const store = setup()
      await store.init()
      store.items = [
        makeTask('每日任務', false, {
          id: 'r',
          order: 0,
          dueDate: '2026-01-01',
          recurrence: {
            freq: 'daily',
            interval: 1,
            byDay: [],
            byMonthDay: null,
            until: null,
            count: null,
          },
        }),
      ]

      store.batchComplete(['r'], true)
      const task = store.items.find((t) => t.id === 'r')
      expect(task?.isCompleted).toBe(false)
      expect(task?.dueDate).toBe('2026-01-02')
    })
  })

  describe('addTask', () => {
    it('產生 UUID 形狀的 id（稽核 P17）', async () => {
      const store = setup()
      await store.init()

      const task = store.add('x')
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })

    it('排序鍵接續在現有最大值之後', async () => {
      const store = setup()
      await store.init()
      const existing = makeTask('既有', false, { order: 5 })
      store.items = [existing]

      expect(store.add('新的').rank > existing.rank).toBe(true)
    })

    it('在共享工作區新增未分類任務時，落到該工作區的收件匣，而不是 projectId／workspaceId 為 null', async () => {
      const store = setup()
      await store.init()
      const collections = useCollectionsStore()
      becomeWorkspaceMember('shared-ws')
      collections.mergeRemote({
        projects: [
          { id: 'shared-inbox', name: '收件匣', color: '#6b7280', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'shared-ws' },
          { id: 'personal-inbox', name: '收件匣', color: '#6b7280', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'personal-ws' },
        ],
        tags: [],
        filters: [],
      })

      const task = store.add('成員新增的任務')
      expect(task.projectId).toBe('shared-inbox')
      expect(task.workspaceId).toBe('shared-ws')
    })

    it('明確指定專案時沿用該專案，但仍標上目前工作區', async () => {
      const store = setup()
      await store.init()
      const collections = useCollectionsStore()
      becomeWorkspaceMember('shared-ws')
      collections.mergeRemote({
        projects: [
          { id: 'shared-inbox', name: '收件匣', color: '#6b7280', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'shared-ws' },
          { id: 'p1', name: '工作', color: '#1d4ed8', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: 'shared-ws' },
        ],
        tags: [],
        filters: [],
      })

      const task = store.add('專案裡的任務', { projectId: 'p1' })
      expect(task.projectId).toBe('p1')
      expect(task.workspaceId).toBe('shared-ws')
    })

    it('純本機模式（沒有工作區）維持未分類：projectId／workspaceId 為 null', async () => {
      const store = setup()
      await store.init()

      const task = store.add('本機任務')
      expect(task.projectId).toBeNull()
      expect(task.workspaceId).toBeNull()
    })

    it('僅檢視時 add 不寫入清單，避免畫面改了卻同步失敗', async () => {
      const store = setup()
      await store.init()
      becomeWorkspaceMember('shared-ws', 'viewer')

      const created = store.add('不該留下的')
      expect(created.taskName).toBe('不該留下的')
      expect(store.items).toHaveLength(0)
      store.toggle(created.id)
      store.update(created.id, { notes: 'x' })
      expect(store.items).toHaveLength(0)
    })
  })

  describe('載入期間不回寫', () => {
    it('init 尚未完成時的初始空陣列不會覆蓋既有資料', async () => {
      await db.saveTasks([makeTask('不可以不見', false, { id: 'a', order: 0 })])
      const spy = vi.spyOn(db, 'applyTaskChanges')

      const store = setup()
      await store.init()
      await nextTick()

      expect(spy, '載入流程本身不應觸發寫入').not.toHaveBeenCalled()
      expect(store.items.map((t) => t.taskName)).toEqual(['不可以不見'])
    })
  })
})

describe('批次操作', () => {
  /**
   * 整批只推一個 undo command 是這一組的重點：使用者按一次「全部順延」
   * 是一個決定，要按二十次 Ctrl+Z 才回得去的話等於沒有復原。
   */
  let store: ReturnType<typeof useTasksStore>
  let history: ReturnType<typeof useHistoryStore>

  beforeEach(() => {
    freshPinia()
    store = useTasksStore()
    history = useHistoryStore()
    store.items = [
      makeTask('一', false, { id: '1' }),
      makeTask('二', false, { id: '2' }),
      makeTask('三', false, { id: '3' }),
    ]
    history.clear()
  })

  it('batchUpdate 一次改多筆，只推一個可復原的命令', async () => {
    const changed = store.batchUpdate(['1', '2'], { priority: 3 }, '設為 P1')
    expect(changed).toBe(2)
    expect(store.items.map((t) => t.priority)).toEqual([3, 3, 0])
    expect(history.depth, '整批算一個命令').toBe(1)

    await history.undo()
    expect(store.items.map((t) => t.priority), '一次復原全部').toEqual([0, 0, 0])
  })

  it('batchRemove 連子項一起刪，也只推一個命令', async () => {
    store.items.push(makeTask('一的子項', false, { id: '1a', parentId: '1' }))
    const removed = store.batchRemove(['1', '2'])

    expect(removed, '父項兩筆加子項一筆').toBe(3)
    expect(store.items.map((t) => t.id)).toEqual(['3'])
    expect(history.depth).toBe(1)

    await history.undo()
    expect(store.items).toHaveLength(4)
  })

  it('batchReschedule 清除日期時一併清掉時間', () => {
    store.items = [makeTask('有時間', false, { id: '1', dueDate: '2030-01-01', dueTime: '09:00' })]
    store.batchReschedule(['1'], null)
    expect(at(store.items, 0).dueDate).toBeNull()
    expect(at(store.items, 0).dueTime, '沒有日期的時間沒有意義').toBeNull()
  })

  it('沒有命中任何 id 時不留下空的復原紀錄', () => {
    store.batchUpdate(['不存在'], { priority: 3 }, '設為 P1')
    expect(history.depth).toBe(0)
  })
})

describe('逐列寫入', () => {
  /**
   * 先前每一次變更都是 clear() 再把全部任務重寫一遍。幾十筆沒感覺，
   * 上千筆時每打一個勾都要付整張表的成本——這一組把「只寫變動的列」釘住。
   */
  beforeEach(() => vi.restoreAllMocks())

  it('只把真的變動的那一列送去寫入', async () => {
    const store = setup()
    await store.init()
    store.items = [makeTask('一', false, { id: '1' }), makeTask('二', false, { id: '2' })]
    await nextTick()
    await store.flush()

    const spy = vi.spyOn(db, 'applyTaskChanges')
    store.update('2', { taskName: '二改過' })
    await nextTick()
    await store.flush()

    // watcher 自己也會觸發一次 flush，所以看的是「所有寫入加起來碰了哪些列」，
    // 而不是被呼叫幾次
    const written = spy.mock.calls.flatMap((call) => call[0].upserts.map((t) => t.id))
    expect([...new Set(written)], '只有第二筆變了').toEqual(['2'])
    expect(spy.mock.calls.flatMap((call) => [...call[0].deletes])).toEqual([])
  })

  it('刪除以明確的 deletes 表達，不再靠整份覆寫', async () => {
    const store = setup()
    await store.init()
    store.items = [makeTask('一', false, { id: '1' }), makeTask('二', false, { id: '2' })]
    await nextTick()
    await store.flush()

    const spy = vi.spyOn(db, 'applyTaskChanges')
    store.remove('1')
    await nextTick()
    await store.flush()

    expect(spy.mock.calls[0]?.[0].deletes).toEqual(['1'])
  })

  it('復原把舊物件放回去時也算變更（只看 updatedAt 會漏掉）', async () => {
    const store = setup()
    await store.init()
    store.items = [makeTask('原本的', false, { id: '1' })]
    await nextTick()
    await store.flush()

    store.update('1', { taskName: '改過的' })
    await nextTick()
    await store.flush()

    const spy = vi.spyOn(db, 'applyTaskChanges')
    await useHistoryStore().undo()
    await nextTick()
    await store.flush()

    expect(spy.mock.calls[0]?.[0].upserts.map((t) => t.taskName)).toEqual(['原本的'])
  })

  it('沒有任何變更時不發出寫入', async () => {
    const store = setup()
    await store.init()
    store.items = [makeTask('一', false, { id: '1' })]
    await nextTick()
    await store.flush()

    const spy = vi.spyOn(db, 'applyTaskChanges')
    await store.flush()
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ upserts: [], deletes: [] })
  })
})

describe('依工作區篩選看得到的任務', () => {
  it('沒有工作區脈絡（尚未登入／純本機）時看得到全部', () => {
    const store = setup()
    store.items = [
      makeTask('本機任務 A', false, { id: '1', workspaceId: null }),
      makeTask('本機任務 B', false, { id: '2', workspaceId: 'w1' }),
    ]
    expect(store.visibleItems.map((t) => t.id).sort()).toEqual(['1', '2'])
  })

  it('切到某個工作區後，只看得到那個工作區、以及還沒同步過（workspaceId 為 null）的任務', () => {
    const store = setup()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    store.items = [
      makeTask('工作區 1 的任務', false, { id: '1', workspaceId: 'w1' }),
      makeTask('工作區 2 的任務', false, { id: '2', workspaceId: 'w2' }),
      makeTask('剛建立還沒同步的任務', false, { id: '3', workspaceId: null }),
    ]
    expect(store.visibleItems.map((t) => t.id).sort()).toEqual(['1', '3'])
  })

  it('countOf／groupsOf／remaining／overdue 都只算看得到的任務', () => {
    const store = setup()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'
    store.items = [
      makeTask('工作區 1', false, { id: '1', workspaceId: 'w1' }),
      makeTask('工作區 2', false, { id: '2', workspaceId: 'w2' }),
    ]
    expect(store.countOf({ kind: 'all', id: null })).toBe(1)
    expect(store.groupsOf({ kind: 'all', id: null }).flatMap((g) => g.tasks).map((t) => t.id)).toEqual(['1'])
    expect(store.remaining).toBe(1)
  })
})
