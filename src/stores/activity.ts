import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { loadActivity, saveActivity } from '@/db'
import type { StoredActivity } from '@/db/schema'

/**
 * 任務活動記錄（M3）。跟 comments.ts／collections.ts 最大的不同：完全
 * 唯讀。活動記錄只由伺服器端的 trigger 產生（見
 * supabase/migrations/0013_activity_log.sql），本地端沒有 add/update/
 * remove，也沒有 flush()／outbox——沒有東西需要從這裡推上去，只有
 * mergeRemote() 把拉回來的資料存進本地快取。
 */
export const useActivityStore = defineStore('activity', () => {
  const items = ref<StoredActivity[]>([])

  /** taskId → 依 createdAt 排序好的活動記錄，跟 comments.ts 的 byTask 同一個道理。 */
  const byTask = computed(() => {
    const map = new Map<string, StoredActivity[]>()
    for (const entry of [...items.value].sort((a, b) => a.createdAt - b.createdAt)) {
      const bucket = map.get(entry.taskId)
      if (bucket) bucket.push(entry)
      else map.set(entry.taskId, [entry])
    }
    return map
  })

  function forTask(taskId: string): StoredActivity[] {
    return byTask.value.get(taskId) ?? []
  }

  async function load(): Promise<void> {
    items.value = await loadActivity()
  }

  /**
   * 純粹的本地快取寫入，沒有指紋、沒有 outbox——這裡跟 tasks.ts／
   * collections.ts 的 flush() 不是同一件事，不需要跟它們的持久化
   * watcher 綁在一起，只有 stores/sync.ts 真的拉到新資料時才需要呼叫。
   *
   * toRaw + 明確淺拷貝 detail：跟 stores/comments.ts 的 snapshot() 同一個坑
   * ——detail 是巢狀物件欄位，一旦被 push 進 reactive 的 items，讀出來的
   * 就是 Vue 的 reactive Proxy，structured clone（IndexedDB 的 put() 底層）
   * 認不得，不 toRaw 就丟給 put() 會直接炸掉 DataCloneError。
   */
  async function persist(): Promise<void> {
    await saveActivity(items.value.map((a) => ({ ...toRaw(a), detail: { ...a.detail } })))
  }

  /** 拉回來的資料只會是新的（activity_log 不可變，沒有本地編輯可能被蓋掉的疑慮），依 id 聯集即可。 */
  function mergeRemote(rows: readonly StoredActivity[]): void {
    const byId = new Map(items.value.map((a) => [a.id, a]))
    for (const row of rows) byId.set(row.id, row)
    items.value = [...byId.values()]
  }

  return { items, forTask, load, persist, mergeRemote }
})
