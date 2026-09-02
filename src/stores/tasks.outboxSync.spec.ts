import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { loadOutbox } from '@/db'
import { makeTask } from '@/test/helpers'

/**
 * flush() 在已設定 Supabase 時，把真的變動的欄位排進離線操作佇列——
 * 拆成獨立檔案的理由跟 AppSidebar.accountConfigured.spec.ts 一樣：
 * vi.mock('@/sync/config', ...) 在檔案層級生效，跟 tasks.spec.ts
 * 其餘假設「沒有接 Supabase」的測試混在一起會互相干擾。未設定時
 * flush() 完全不碰 outbox，在 tasks.spec.ts 那邊本來就是預設狀態，
 * 不需要另外驗證。
 */
vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useTasksStore()
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('flush() 排入離線操作佇列（已設定 Supabase）', () => {
  it('新增任務排一筆 task.create，payload 是遠端形狀的完整列', async () => {
    const store = setup()
    await store.init()

    const task = store.add('買牛奶')
    await store.flush()

    const ops = await loadOutbox()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.kind).toBe('task.create')
    expect(ops[0]?.targetId).toBe(task.id)
    expect(ops[0]?.payload).toMatchObject({ id: task.id, task_name: '買牛奶' })
  })

  it('只改一個欄位時，補丁只包含那個欄位——不是整列', async () => {
    const store = setup()
    await store.init()
    const task = store.add('原始名稱')
    await store.flush()

    store.update(task.id, { notes: '只改備註' })
    await store.flush()

    const ops = await loadOutbox()
    const patchOp = ops.find((o) => o.kind === 'task.patch')
    expect(patchOp?.payload).toMatchObject({ notes: '只改備註' })
    expect(patchOp?.payload).not.toHaveProperty('task_name')
  })

  it('刪除任務排一筆 task.delete，payload 帶 deleted_at', async () => {
    const store = setup()
    await store.init()
    const task = store.add('要被刪除的')
    await store.flush()

    store.remove(task.id)
    await store.flush()

    const ops = await loadOutbox()
    const deleteOp = ops.find((o) => o.kind === 'task.delete')
    expect(deleteOp?.targetId).toBe(task.id)
    expect(typeof deleteOp?.payload.deleted_at).toBe('number')
  })

  it('同一次 flush 裡多筆欄位各自沒變時，不排入任何補丁（沒有變動就沒有 op）', async () => {
    const store = setup()
    await store.init()
    const task = store.add('不會再改的')
    await store.flush()

    // 沒有任何變動再呼叫一次 flush()：watcher 不會觸發（deep watch
    // 沒偵測到變化），但直接呼叫 flush() 本身應該也是安全的 no-op。
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.filter((o) => o.targetId === task.id)).toHaveLength(1) // 只有最初那筆 create
  })

  it('undo 回到舊內容也會排一筆補丁——復原本身也是一次真正的變更', async () => {
    const store = setup()
    await store.init()
    const task = store.add('原始')
    await store.flush()
    store.update(task.id, { notes: '改過的備註' })
    await store.flush()

    const history = (await import('@/stores/history')).useHistoryStore()
    history.undo()
    await store.flush()

    const ops = await loadOutbox()
    const patchOps = ops.filter((o) => o.kind === 'task.patch' && o.targetId === task.id)
    expect(patchOps.at(-1)?.payload).toMatchObject({ notes: '' })
  })

  it('批次更新對每一筆受影響的任務各排一筆補丁', async () => {
    const store = setup()
    await store.init()
    const a = store.add('A')
    const b = store.add('B')
    await store.flush()

    store.batchUpdate([a.id, b.id], { priority: 3 }, '批次調整優先度')
    await store.flush()

    const ops = await loadOutbox()
    const patches = ops.filter((o) => o.kind === 'task.patch')
    expect(patches.map((o) => o.targetId).sort()).toEqual([a.id, b.id].sort())
    for (const op of patches) expect(op.payload).toMatchObject({ priority: 3 })
  })

  /**
   * 釘住一個真實抓到的自我循環風險：mergeRemote() 寫回 items.value 後，
   * 內容跟 persistedIndex 不一樣（還沒真的存進本地 IndexedDB），如果不
   * 特別排除，flush() 會分不出「這是使用者剛編輯的」還是「這是剛從
   * 伺服器拉回來的」，把剛拉回來的資料當成本地變更又推一次回去——
   * 跟 stores/sync.ts 已經修過一次的「遠端沒變化仍觸發推送」是同一類問題。
   */
  it('mergeRemote 寫入的資料不會被 flush() 誤判成本地變更、推回 outbox', async () => {
    const store = setup()
    await store.init()

    store.mergeRemote([makeTask('遠端來的', false, { id: 'remote-1' })])
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.some((o) => o.targetId === 'remote-1')).toBe(false)
  })

  it('mergeRemote 造成的遠端刪除，不會被 flush() 誤判成本地刪除、推一筆墓碑回去', async () => {
    const store = setup()
    await store.init()
    const task = store.add('之後會被遠端刪掉的')
    await store.flush()
    await loadOutbox() // 清一下：這裡的 create op 不是這個案例要驗證的重點

    // 模擬 stores/sync.ts 拉回來的結果：這一列在遠端已經被刪除，
    // mergeRemote 收到的陣列裡不會再有它。
    store.mergeRemote([])
    await store.flush()

    const ops = await loadOutbox()
    expect(ops.some((o) => o.targetId === task.id && o.kind === 'task.delete')).toBe(false)
  })

  it('合併之後，使用者真的編輯同一筆資料時，補丁照常產生——排除只作用在合併當下那一次 flush', async () => {
    const store = setup()
    await store.init()

    store.mergeRemote([makeTask('遠端來的', false, { id: 'remote-1' })])
    await store.flush()

    store.update('remote-1', { notes: '使用者後來加的備註' })
    await store.flush()

    const ops = await loadOutbox()
    const patchOp = ops.find((o) => o.kind === 'task.patch' && o.targetId === 'remote-1')
    expect(patchOp?.payload).toMatchObject({ notes: '使用者後來加的備註' })
  })
})
