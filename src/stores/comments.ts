import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { loadComments, saveComments } from '@/db'
import type { StoredComment } from '@/db/schema'
import { parseMentions } from '@/domain/mentions'
import { isSyncConfigured } from '@/sync/config'
import { toRemoteComment } from '@/sync/rowMapping'
import { useHistoryStore } from './history'
import { useAuthStore } from './auth'
import { useWorkspaceStore } from './workspace'
import { enqueueCollectionOps } from './outboxSync'

/**
 * 任務留言（M3）。獨立成一個 store 而不是塞進 tasks.ts：留言的生命週期
 * 跟量級都跟任務本體不同（一筆任務可能有零到幾十則留言，任務本身則是
 * 使用者清單的主體），混在一起會讓 tasks.ts 的持久化 watcher 多背一份
 * 跟任務排序／篩選毫無關係的資料。
 *
 * 只在已設定同步、且已登入時才有意義——留言是「跟別人對話」，純本機
 * 模式下沒有別人可以對話，UI 層（TaskComments.vue）整段不顯示，不是
 * 顯示一個永遠空著的留言區。
 */
export const useCommentsStore = defineStore('comments', () => {
  const items = ref<StoredComment[]>([])
  const history = useHistoryStore()
  const auth = useAuthStore()
  const workspace = useWorkspaceStore()

  /** @提及要比對的成員名單，跟 TaskComments.vue 顯示作者名稱是同一份資料。 */
  function mentionableMembers() {
    return workspace.members.map((m) => ({ userId: m.user_id, displayName: m.profiles?.display_name ?? '' }))
  }

  /** taskId → 依 createdAt 排序好的留言，畫面一次算好整張表，不是每次都重新 filter+sort。 */
  const byTask = computed(() => {
    const map = new Map<string, StoredComment[]>()
    for (const comment of [...items.value].sort((a, b) => a.createdAt - b.createdAt)) {
      const bucket = map.get(comment.taskId)
      if (bucket) bucket.push(comment)
      else map.set(comment.taskId, [comment])
    }
    return map
  })

  function forTask(taskId: string): StoredComment[] {
    return byTask.value.get(taskId) ?? []
  }

  /** 純粹用來推導 outbox 補丁的內容指紋，跟本地 IndexedDB 寫入無關（見 stores/outboxSync.ts 的說明）。 */
  let persistedIndex = new Map<string, string>()
  /** mergeRemote() 這次動到的 id，下一次 flush() 消費後清空——理由跟 stores/tasks.ts 的 remoteMergedIds 一致。 */
  let remoteMergedIds = new Set<string>()

  async function load(): Promise<void> {
    items.value = await loadComments()
    persistedIndex = new Map(items.value.map((c) => [c.id, JSON.stringify(c)]))
  }

  /**
   * toRaw + 明確淺拷貝 mentionedUserIds：跟 stores/tasks.ts 的 snapshot()
   * 是同一個坑——structured clone（IndexedDB 的 put() 底層用的）認不得
   * Vue 的 reactive Proxy，陣列欄位不 toRaw 就丟給 put() 會直接炸掉
   * DataCloneError，不是本地測試才會踩到，瀏覽器裡一樣會發生。toRaw()
   * 只解開最外層代理，巢狀的陣列／物件還是要自己再展開一次。
   *
   * enqueueCollectionOps() 最終也會把這裡的每一列送進 enqueueOp()（同一個
   * put()），所以 flush() 存本地跟排 outbox op 都要用這份，不能只顧其中一邊。
   */
  function snapshot(): StoredComment[] {
    return items.value.map((c) => ({ ...toRaw(c), mentionedUserIds: [...c.mentionedUserIds] }))
  }

  async function flush(): Promise<void> {
    const rows = snapshot()
    await saveComments(rows)
    if (isSyncConfigured) {
      persistedIndex = await enqueueCollectionOps('comment', rows, persistedIndex, toRemoteComment, remoteMergedIds)
      remoteMergedIds = new Set()
    }
  }

  function add(taskId: string, body: string): StoredComment {
    const now = Date.now()
    const comment: StoredComment = {
      id: crypto.randomUUID(),
      taskId,
      // 只有 UI 已經確認登入時才會呼叫到這裡（見上方說明）；空字串是
      // defensive fallback，不是預期會走到的分支。
      authorId: auth.session?.user.id ?? '',
      body,
      mentionedUserIds: parseMentions(body, mentionableMembers()),
      createdAt: now,
      updatedAt: now,
    }
    if (!workspace.canComment) return comment
    items.value.push(comment)
    history.record({
      label: '新增留言',
      undo: () => {
        items.value = items.value.filter((c) => c.id !== comment.id)
      },
      redo: () => {
        items.value.push(comment)
      },
    })
    return comment
  }

  /** 留言唯一可編輯的欄位就是內容本身——沒有標題、顏色、優先度這些；提及重新解析一次，編輯時改了對象也會反映。 */
  function update(id: string, body: string): void {
    if (!workspace.canComment) return
    const index = items.value.findIndex((c) => c.id === id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredComment) }
    const after = { ...before, body, mentionedUserIds: parseMentions(body, mentionableMembers()), updatedAt: Date.now() }
    items.value[index] = after
    history.record({
      label: '編輯留言',
      undo: () => {
        const i = items.value.findIndex((c) => c.id === id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = items.value.findIndex((c) => c.id === id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  function remove(id: string): void {
    if (!workspace.canComment) return
    const comment = items.value.find((c) => c.id === id)
    if (!comment) return
    items.value = items.value.filter((c) => c.id !== id)
    history.record({
      label: '刪除留言',
      undo: () => {
        items.value = [...items.value, comment]
      },
      redo: () => {
        items.value = items.value.filter((c) => c.id !== id)
      },
    })
  }

  /** 跟 stores/collections.ts 的 mergeRemote 同一個道理，不記錄復原——這不是使用者剛做的本地操作。 */
  function mergeRemote(rows: readonly StoredComment[]): void {
    remoteMergedIds = new Set([...remoteMergedIds, ...items.value.map((c) => c.id), ...rows.map((c) => c.id)])
    items.value = [...rows]
  }

  return { items, forTask, load, flush, add, update, remove, mergeRemote }
})
