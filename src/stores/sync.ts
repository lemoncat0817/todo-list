import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { clearOutbox, getMeta, loadOutbox, markOpAttempt, removeOp, setMeta } from '@/db'
import {
  META_SYNC_ACCOUNT_ID,
  META_SYNC_LAST_PULLED_AT,
  type StoredActivity,
  type StoredComment,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from '@/db/schema'
import {
  normalizeActivity,
  normalizeComment,
  normalizeFilter,
  normalizeProject,
  normalizeTag,
  normalizeTask,
} from '@/domain/task'
import { mergeByUpdatedAt } from '@/sync/merge'
import { sendOp } from '@/sync/rpc'
import { SyncHttpError } from '@/sync/restClient'
import { pullTable, type TableBinding } from '@/sync/tableSync'
import type { WorkspaceSubscription } from '@/sync/realtime'
import {
  TABLE_ACTIVITY,
  TABLE_COMMENTS,
  TABLE_FILTERS,
  TABLE_PROJECTS,
  TABLE_TAGS,
  TABLE_TASKS,
  fromRemoteActivity,
  fromRemoteComment,
  fromRemoteFilter,
  fromRemoteProject,
  fromRemoteTag,
  fromRemoteTask,
} from '@/sync/rowMapping'
import { useAuthStore } from './auth'
import { useTasksStore } from './tasks'
import { useActivityStore } from './activity'
import { useCollectionsStore } from './collections'
import { useCommentsStore } from './comments'
import { useWorkspaceStore } from './workspace'

/**
 * 同步是背景輪詢，不是即時協作——所以用固定間隔加幾個「現在很可能有變化」
 * 的時機點補洞（回到分頁、恢復網路），而不是 WebSocket。
 */
const PULL_INTERVAL_MS = 30_000
/** 本地編輯觸發推送前先等一下：一串連續編輯（例如批次操作）只值得推一次。 */
const PUSH_DEBOUNCE_MS = 3_000

const taskBinding: TableBinding<StoredTask> = {
  table: TABLE_TASKS,
  fromRemote: fromRemoteTask,
  normalize: (raw) => normalizeTask(raw),
}
const projectBinding: TableBinding<StoredProject> = {
  table: TABLE_PROJECTS,
  fromRemote: fromRemoteProject,
  normalize: (raw) => normalizeProject(raw),
}
const tagBinding: TableBinding<StoredTag> = {
  table: TABLE_TAGS,
  fromRemote: fromRemoteTag,
  normalize: (raw) => normalizeTag(raw),
}
const filterBinding: TableBinding<StoredFilter> = {
  table: TABLE_FILTERS,
  fromRemote: fromRemoteFilter,
  normalize: (raw) => normalizeFilter(raw),
}
const commentBinding: TableBinding<StoredComment> = {
  table: TABLE_COMMENTS,
  fromRemote: fromRemoteComment,
  normalize: (raw) => normalizeComment(raw),
}
const activityBinding: TableBinding<StoredActivity> = {
  table: TABLE_ACTIVITY,
  fromRemote: fromRemoteActivity,
  normalize: (raw) => normalizeActivity(raw),
}

/**
 * 把同步失敗的原因轉成使用者看得懂的中文，不直接把技術錯誤丟到畫面上。
 *
 * 修 PGRST102 那個 bug 時發現的另一個問題：`syncError.value` 原本直接存
 * `error.message`，`SyncHttpError` 的訊息長這樣——
 * `[sync] upsert tasks 失敗（HTTP 400）：{"code":"PGRST102","details":null,...}`
 * ——資料表名稱、HTTP 狀態碼、PostgREST 原始錯誤 JSON 全部照樣顯示在
 * `AccountDialog.vue`／`AppSidebar.vue` 上。這跟 `stores/auth.ts` 的
 * `describeError()` 已經在做的事（見那邊的註解：「使用者不需要、也不該
 * 知道這個工具背後接的是什麼服務」）是同一個原則，卻只做了一半——認證
 * 錯誤有翻譯，同步錯誤沒有。這裡補上同一套處理：只分「網路連不上」跟
 * 「伺服器那邊出了問題」兩種使用者看得懂、也不會誤導的說法，兩種都誠實
 * 告知「會自動重試」（`syncOnce()` 本來就會被 30 秒輪詢、回到分頁、恢復
 * 連線重新呼叫，不是空話）。技術細節改用 `console.error` 留給開發者
 * 從 DevTools 查，不再出現在使用者看得到的畫面上。
 */
function describeSyncError(error: unknown): string {
  // fetch 本身連不上（離線、DNS、CORS 之類）在瀏覽器一律是拋出
  // `TypeError: Failed to fetch`，跟「伺服器回應了、但回應是錯的」
  // （SyncHttpError）性質不同，值得分開講。
  if (error instanceof TypeError) return '目前連不上網路，恢復連線後會自動重試'
  if (error instanceof SyncHttpError) return '伺服器暫時無法處理，稍後會自動重試'
  return '發生未預期的問題，稍後會自動重試'
}

/**
 * 跨裝置同步的協調層。
 *
 * 依賴方向是 sync → tasks／collections／auth，不是反過來：tasks.ts／
 * collections.ts 完全不知道同步這件事存在，這裡自己 watch 它們的狀態，
 * 跟 tasks.ts 自己 watch 本地狀態去寫 IndexedDB 是同一個模式，只是這裡
 * 寫的目的地是遠端。這樣沒有帳號的使用者，tasks.ts／collections.ts
 * 一行都不用因為同步而改變。
 *
 * start()／stop() 由這裡自己 watch auth.status 觸發，不是靠呼叫端
 * （main.ts、AccountDialog.vue）各自記得在對的時機呼叫——那曾經是一個真實
 * 的漏洞：登入如果不是在「按下驗證按鈕」這個分頁完成的（例如使用者點了
 * 信件裡的連結，在另一個分頁登入，透過 stores/auth.ts 的跨分頁廣播反映
 * 回這個分頁），auth.status 會正確變成 signed-in，但沒有任何程式碼記得
 * 在這個分頁呼叫 sync.start()，同步引擎就永遠不會啟動。改成單一個 watch，
 * 不管登入是在哪個分頁、用哪種方式（信箱驗證碼、magic link、OAuth、
 * 開機還原）完成的，auth.status 一旦是 signed-in 就自動開始同步。
 */
export const useSyncStore = defineStore('sync', () => {
  const enabled = ref(false)
  const syncError = ref<string | null>(null)
  const lastPulledAt = ref<number | null>(null)

  const auth = useAuthStore()
  const tasks = useTasksStore()
  const collections = useCollectionsStore()
  const comments = useCommentsStore()
  const activity = useActivityStore()
  const workspace = useWorkspaceStore()

  let inFlight: Promise<void> | null = null
  let dirty = false
  let interval: ReturnType<typeof setInterval> | null = null
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatching: (() => void) | null = null
  let stopWorkspaceWatching: (() => void) | null = null

  /**
   * outbox 依序送出，中途失敗就整批停下——不能跳過失敗的那筆繼續送
   * 後面的，不然同一筆任務的兩個補丁有可能倒著順序抵達伺服器。失敗的
   * 那筆記一次重試次數（markOpAttempt，供未來做退避用），錯誤原樣往上
   * 丟給 syncOnce() 既有的 try/catch，走同一套 describeSyncError()。
   *
   * 四張表（tasks/projects/tags/filters）的 op 混在同一個佇列裡，
   * 依 createdAt 排序一起送——outbox 本來就不分表，見 stores/tasks.ts
   * 的 enqueueSyncOps／stores/collections.ts 的 enqueueCollectionOps。
   */
  async function drainOutbox(token: string): Promise<void> {
    const ops = await loadOutbox()
    for (const op of ops) {
      try {
        await sendOp(op, token)
        await removeOp(op.id)
      } catch (error) {
        await markOpAttempt(op.id)
        throw error
      }
    }
  }

  /**
   * 一張表的拉取＋合併。push 已經由 drainOutbox() 統一做掉，這裡不再
   * 需要指紋——「哪些欄位變了」在各自 store 的 flush() 就已經決定、
   * 寫進 outbox 了，也不需要拉取贏了之後回頭更新指紋（沒有指紋了）。
   *
   * 合併故意讀 `readLocal()`（呼叫當下的最新值），不是進函式當時就固定
   * 住的參數——中間有一次網路等待（拉取），這段時間本地如果發生
   * 「整份陣列替換」式的操作（remove／batchUpdate／undo…），合併時用
   * 一份舊快照當基準會把那個操作靜靜蓋掉。
   *
   * `applyMerge()` 只在真的有東西要改（遠端贏了某幾列、或遠端回報刪除）
   * 時才呼叫——不然就算這一輪遠端完全沒有變化，`mergeByUpdatedAt` 仍然
   * 回傳一個內容相同、但參照不同的新陣列，寫回 `tasks.items`／
   * `collections.*` 會觸發下面 `start()` 的「本地編輯」防抖 watcher
   * （它分不出這次陣列替換是使用者剛編輯的，還是同步自己寫回去的），
   * 排出下一次推送，形成每 PUSH_DEBOUNCE_MS 就自己觸發一次的無窮迴圈，
   * 完全繞過 PULL_INTERVAL_MS 輪詢間隔。是寫 flushPendingPush() 回歸
   * 測試時才發現的：一輪同步剛跑完，照理不該有任何「還沒送出的變更」，
   * 但 pushTimer 卻總是掛著。
   */
  async function pullAndMerge<T extends { id: string; updatedAt: number }>(
    binding: TableBinding<T>,
    readLocal: () => readonly T[],
    cursor: number,
    token: string,
    applyMerge: (rows: T[]) => void,
  ): Promise<void> {
    const { live, deletedIds } = await pullTable(binding, cursor, token)
    const merge = mergeByUpdatedAt(readLocal(), live, deletedIds)
    if (merge.remoteWon.length > 0 || merge.removedIds.length > 0) applyMerge(merge.merged)
  }

  async function persist(): Promise<void> {
    await setMeta(META_SYNC_LAST_PULLED_AT, lastPulledAt.value)
  }

  /**
   * Realtime 把輪詢間隔壓到即時，但只是把 PULL_INTERVAL_MS 的等待戳早一點
   * 觸發——套用資料仍然走同一條 pullAndMerge，不是另外解析即時事件，
   * 見 sync/realtime.ts 開頭的說明。
   *
   * 訂閱使用者所屬的「每一個」工作區，不是只訂閱目前選在 MembersDialog
   * 裡的那一個：拉取本身還沒依 workspace_id 篩選（見 stores/tasks.ts／
   * collections.ts 目前的已知範圍界定），任一個工作區的即時事件都觸發
   * 同一次全量 syncOnce()。只訂閱「目前選中」的那個會造成不一致——
   * 其他工作區的變更仍然要等到下一次輪詢，體感時快時慢。
   */
  let realtimeSubscriptions = new Map<string, WorkspaceSubscription>()
  let realtimeModulePromise: Promise<typeof import('@/sync/realtime')> | null = null
  function ensureRealtimeModule(): Promise<typeof import('@/sync/realtime')> {
    realtimeModulePromise ??= import('@/sync/realtime')
    return realtimeModulePromise
  }

  /** 實際做訂閱差異比對的部分，呼叫端負責序列化呼叫，避免併發呼叫時重複訂閱同一個工作區。 */
  async function reconcileRealtimeSubscriptions(): Promise<void> {
    const realtime = await ensureRealtimeModule()
    const currentIds = new Set(workspace.workspaces.map((w) => w.id))

    for (const [id, subscription] of realtimeSubscriptions) {
      if (!currentIds.has(id)) {
        subscription.stop()
        realtimeSubscriptions.delete(id)
      }
    }

    for (const id of currentIds) {
      if (realtimeSubscriptions.has(id)) continue
      realtimeSubscriptions.set(
        id,
        realtime.subscribeToWorkspace({
          workspaceId: id,
          getAccessToken: async () => auth.session?.access_token ?? null,
          onChange: () => void syncOnce(),
          onSubscribed: () => void syncOnce(),
        }),
      )
    }
  }

  /**
   * 序列化呼叫：workspace.workspaces 短時間內可能連續變動好幾次（例如
   * load() 剛把清單填進去、緊接著又因為別的原因重新賦值），如果讓
   * reconcileRealtimeSubscriptions() 的呼叫直接併發跑，兩次呼叫都可能
   * 在對方寫進 Map 之前就判斷「這個工作區還沒訂閱」，各自訂閱一次，
   * 變成同一個工作區訂閱了兩個重複的頻道。串成一條 promise 鏈，
   * 確保上一次的診斷（含它對 Map 的寫入）完全結束才開始下一次。
   */
  let realtimeSyncChain: Promise<void> = Promise.resolve()
  function scheduleRealtimeSync(): void {
    realtimeSyncChain = realtimeSyncChain
      .then(() => reconcileRealtimeSubscriptions())
      .catch((error: unknown) => console.error('[sync] realtime 訂閱失敗', error))
  }

  function stopRealtimeSubscriptions(): void {
    for (const subscription of realtimeSubscriptions.values()) subscription.stop()
    realtimeSubscriptions = new Map()
    realtimeSyncChain = Promise.resolve()
  }

  /** 跟 stores/tasks.ts 的 flush() 同一套 inFlight／dirty 寫法：呼叫中再被呼叫就排隊重跑一次。 */
  function syncOnce(): Promise<void> {
    if (inFlight) {
      dirty = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          dirty = false
          const token = auth.session?.access_token
          // 還沒登入，或 session 還沒還原完成——不算錯誤，安靜跳過等下一輪
          if (!token) return

          const cursor = lastPulledAt.value ?? 0
          const startedAt = Date.now()

          await drainOutbox(token)
          await pullAndMerge(taskBinding, () => tasks.items, cursor, token, tasks.mergeRemote)
          await pullAndMerge(
            projectBinding,
            () => collections.projects,
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: rows, tags: collections.tags, filters: collections.filters }),
          )
          await pullAndMerge(
            tagBinding,
            () => collections.tags,
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: collections.projects, tags: rows, filters: collections.filters }),
          )
          await pullAndMerge(
            filterBinding,
            () => collections.filters,
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: collections.projects, tags: collections.tags, filters: rows }),
          )
          await pullAndMerge(commentBinding, () => comments.items, cursor, token, comments.mergeRemote)
          // activity 沒有本地編輯、沒有 outbox，applyMerge 直接把
          // mergeRemote 跟本地快取寫入接在一起做，不像其餘幾張表要靠
          // tasks.ts 的持久化 watcher 間接觸發。
          await pullAndMerge(activityBinding, () => activity.items, cursor, token, (rows) => {
            activity.mergeRemote(rows)
            void activity.persist()
          })

          lastPulledAt.value = startedAt
          await persist()
          syncError.value = null
        } while (dirty)
      } catch (error) {
        // 技術細節（表名、HTTP 狀態碼、PostgREST 原始錯誤 JSON）留給 DevTools，
        // 畫面上只顯示 describeSyncError() 翻譯過的說法。
        console.error('[sync] 同步失敗', error)
        syncError.value = describeSyncError(error)
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  function onReconnectOrFocus(): void {
    if (document.visibilityState === 'hidden') return
    void syncOnce()
  }

  /**
   * 離開頁面前盡力把還沒送出的推送送出去——跟 main.ts 對本地 IndexedDB
   * 寫入做的事（pagehide／visibilitychange 觸發 store.flush()）是同一個
   * 道理，補的是本地寫入沒涵蓋到的那一段。
   *
   * 本地寫入本身沒有防抖（tasks.ts 的 flush() 是即時觸發，寫的是 IndexedDB），
   * 但推送到遠端刻意防抖 PUSH_DEBOUNCE_MS（一串連續編輯只值得推一次）——
   * 這代表「編輯完（包括刪除）就立刻關分頁、切換帳號、或登出」時，防抖
   * 計時器很可能還沒觸發：這次修改從頭到尾沒有送到伺服器過，本機
   * IndexedDB 看起來改好了／刪除了，伺服器上那幾筆卻還是原封不動。下次
   * 從別的裝置、別的分頁、甚至同一台裝置換帳號再換回來同步時，會像是
   * 「已經刪除的東西又出現了」——不是同步機制本身壞掉，是那次變更根本
   * 沒机会真的送出去過。
   *
   * 只在真的有還沒送出的變更時（pushTimer 還掛著）才補送一次；沒有掛著
   * 代表已經送過或本來就沒有變更，不需要多打一次網路請求。跟本地端那個
   * flush() 一樣，這裡不能保證頁面關閉前一定送完（fetch 可能來不及完成
   * 瀏覽器就終止了分頁），只能盡量把空窗縮到最小。
   */
  function flushPendingPush(): Promise<void> {
    if (!pushTimer) return Promise.resolve()
    clearTimeout(pushTimer)
    pushTimer = null
    return syncOnce()
  }

  /**
   * 本地快取（IndexedDB 裡的 tasks／projects／tags／filters，加上這個 store
   * 的同步游標，以及 outbox 裡還沒送出的操作）從頭到尾沒有依「目前登入
   * 的是誰」分區——這是刻意的離線優先設計：`stores/auth.ts` 的
   * `signOut()` 明確不清本地資料，這裡的 `stop()` 也一樣。但這只涵蓋了
   * 「同一個人換裝置」，沒有涵蓋「同一台裝置／瀏覽器換了不同的人登入」
   * ——這種情況下，新登入的帳號會直接繼承、甚至把上一個帳號留在本機的
   * 資料當成自己的推送上去，是真正的資料隔離缺陷，不是單純的畫面顯示
   * 問題：使用者會看到不屬於自己的待辦內容，而且只要在那個狀態下編輯
   * 任何一筆，就會嘗試用自己的帳號去寫一筆 id 屬於另一個使用者的遠端列。
   *
   * 做法比照業界慣例（Google Drive／Dropbox 換帳號登入時的處理）：本地
   * 額外記一把「這份快取上次是跟哪個 user id 對過帳」（`META_SYNC_ACCOUNT_ID`）。
   * 登入時發現跟上次不同，代表這份本地快取邏輯上不屬於新使用者，直接
   * 清空（`mergeRemote([])`／`mergeRemote({ projects: [], tags: [], filters: [] })`
   * ——跟遠端合併結果套用是同一條路徑，不特別記一筆復原命令，理由跟
   * `tasks.ts` 的 `mergeRemote` 一致：這不是使用者在這台裝置上剛做的操作）、
   * 把游標歸零、並清空 outbox（上一個帳號還沒送出的操作不該用新身分
   * 送出去）——下一輪同步會用乾淨狀態完整拉一次新帳號在伺服器上真正的
   * 資料，不會有任何本地殘留被誤判成新帳號的內容，也不會有本地殘留被
   * 誤推到新帳號名下。
   *
   * 「本地從沒記錄過任何 owner」時（全新安裝、或使用者第一次登入前就已經
   * 累積的本地待辦）刻意不清——那是使用者真正想要的既有行為：登入後把
   * 裝置上原有的本地資料併進帳號、推上雲端。這個修法只處理「已經有一個
   * 明確 owner，換了另一個人」這一種情況，不影響「還沒有 owner」的首次登入。
   */
  async function reconcileAccountIdentity(): Promise<void> {
    const currentUserId = auth.session?.user.id
    if (!currentUserId) return

    const lastOwnerId = await getMeta<string>(META_SYNC_ACCOUNT_ID)
    if (lastOwnerId && lastOwnerId !== currentUserId) {
      tasks.mergeRemote([])
      collections.mergeRemote({ projects: [], tags: [], filters: [] })
      comments.mergeRemote([])
      activity.mergeRemote([])
      // activity 不掛在 tasks.ts 的持久化 watcher 上（見上面 syncOnce()
      // 的註解），這裡清空後要自己補一次本地寫入，不然清完的只是記憶體
      // 裡的狀態，IndexedDB 裡上一個帳號的活動記錄還留著。
      await activity.persist()
      lastPulledAt.value = 0
      await clearOutbox()
      await persist()
    }

    await setMeta(META_SYNC_ACCOUNT_ID, currentUserId)
  }

  /**
   * 由下面的 auth.status watcher 自動呼叫，不需要（也不該）由元件手動呼叫——
   * 手動呼叫還留著只是方便測試直接驗證 start() 本身的行為。
   */
  async function start(): Promise<void> {
    if (enabled.value) return
    enabled.value = true
    syncError.value = null

    await reconcileAccountIdentity()
    // reconcileAccountIdentity 讀 IndexedDB，中途 stop() 可能已經被呼叫
    // （例如登入後很快又登出）——這裡不檢查的話，下面還是會照樣掛上
    // window/document 監聽器與 interval，讓一個已經 stop() 的同步又悄悄復活。
    if (!enabled.value) return

    lastPulledAt.value = (await getMeta<number>(META_SYNC_LAST_PULLED_AT)) ?? 0
    // 同一個理由再檢查一次：上面這次讀取也是獨立的 await，stop() 一樣
    // 可能發生在期間。
    if (!enabled.value) return

    void syncOnce()
    interval = setInterval(() => void syncOnce(), PULL_INTERVAL_MS)
    window.addEventListener('online', onReconnectOrFocus)
    document.addEventListener('visibilitychange', onReconnectOrFocus)

    stopWatching = watch(
      [
        () => tasks.items,
        () => collections.projects,
        () => collections.tags,
        () => collections.filters,
        () => comments.items,
      ],
      () => {
        if (pushTimer) clearTimeout(pushTimer)
        pushTimer = setTimeout(() => void syncOnce(), PUSH_DEBOUNCE_MS)
      },
      { deep: true },
    )

    // immediate: true——workspace.workspaces 這時多半已經有內容（也可能
    // 還是空的，load() 還沒回來），兩種情況都正確：空的話 diff 出來就是
    // 沒有訂閱，等 workspace.ts 的 load() 填進資料時這個 watcher 自然
    // 會再跑一次。
    stopWorkspaceWatching = watch(() => workspace.workspaces, scheduleRealtimeSync, { deep: true, immediate: true })
  }

  /** 只斷開同步，不動本地資料——離線優先，清空本地是另一個明確動作。 */
  function stop(): void {
    enabled.value = false
    syncError.value = null
    if (interval) clearInterval(interval)
    interval = null
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = null
    window.removeEventListener('online', onReconnectOrFocus)
    document.removeEventListener('visibilitychange', onReconnectOrFocus)
    stopWatching?.()
    stopWatching = null
    stopWorkspaceWatching?.()
    stopWorkspaceWatching = null
    stopRealtimeSubscriptions()
  }

  // 單一個真相來源：不管登入是在哪個分頁、用哪種方式完成的，只要
  // auth.status 變成 signed-in 就自動開始同步；變成 signed-out（不管是
  // 使用者主動登出、或 session 過期）就自動停止。immediate: true 是為了
  // 涵蓋「這個 store 是在已經登入之後才第一次被 useSyncStore() 建立」的
  // 情況，不必依賴呼叫順序。
  watch(
    () => auth.status,
    (status) => {
      if (status === 'signed-in') void start()
      else stop()
    },
    { immediate: true },
  )

  return { enabled, syncError, lastPulledAt, start, stop, flushPendingPush }
})
