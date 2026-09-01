import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { getMeta, setMeta } from '@/db'
import {
  META_SYNC_ACCOUNT_ID,
  META_SYNC_FINGERPRINT_FILTERS,
  META_SYNC_FINGERPRINT_PROJECTS,
  META_SYNC_FINGERPRINT_TAGS,
  META_SYNC_FINGERPRINT_TASKS,
  META_SYNC_LAST_PULLED_AT,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
  type StoredTask,
} from '@/db/schema'
import { normalizeFilter, normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'
import { mergeByUpdatedAt } from '@/sync/merge'
import { SyncHttpError } from '@/sync/restClient'
import { pullTable, pushTable, type TableBinding } from '@/sync/tableSync'
import {
  TABLE_FILTERS,
  TABLE_PROJECTS,
  TABLE_TAGS,
  TABLE_TASKS,
  fromRemoteFilter,
  fromRemoteProject,
  fromRemoteTag,
  fromRemoteTask,
  toRemoteFilter,
  toRemoteProject,
  toRemoteTag,
  toRemoteTask,
} from '@/sync/rowMapping'
import { useAuthStore } from './auth'
import { useTasksStore } from './tasks'
import { useCollectionsStore } from './collections'

/**
 * 同步是背景輪詢，不是即時協作——所以用固定間隔加幾個「現在很可能有變化」
 * 的時機點補洞（回到分頁、恢復網路），而不是 WebSocket。
 */
const PULL_INTERVAL_MS = 30_000
/** 本地編輯觸發推送前先等一下：一串連續編輯（例如批次操作）只值得推一次。 */
const PUSH_DEBOUNCE_MS = 3_000

interface Fingerprints {
  tasks: Map<string, string>
  projects: Map<string, string>
  tags: Map<string, string>
  filters: Map<string, string>
}

async function loadFingerprint(key: string): Promise<Map<string, string>> {
  const raw = await getMeta<Record<string, string>>(key)
  return new Map(Object.entries(raw ?? {}))
}

function saveFingerprint(key: string, fingerprint: Map<string, string>): Promise<void> {
  return setMeta(key, Object.fromEntries(fingerprint))
}

const taskBinding: TableBinding<StoredTask> = {
  table: TABLE_TASKS,
  toRemote: toRemoteTask,
  fromRemote: fromRemoteTask,
  normalize: (raw) => normalizeTask(raw),
}
const projectBinding: TableBinding<StoredProject> = {
  table: TABLE_PROJECTS,
  toRemote: toRemoteProject,
  fromRemote: fromRemoteProject,
  normalize: (raw) => normalizeProject(raw),
}
const tagBinding: TableBinding<StoredTag> = {
  table: TABLE_TAGS,
  toRemote: toRemoteTag,
  fromRemote: fromRemoteTag,
  normalize: (raw) => normalizeTag(raw),
}
const filterBinding: TableBinding<StoredFilter> = {
  table: TABLE_FILTERS,
  toRemote: toRemoteFilter,
  fromRemote: fromRemoteFilter,
  normalize: (raw) => normalizeFilter(raw),
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

  let fingerprints: Fingerprints = {
    tasks: new Map(),
    projects: new Map(),
    tags: new Map(),
    filters: new Map(),
  }

  let inFlight: Promise<void> | null = null
  let dirty = false
  let interval: ReturnType<typeof setInterval> | null = null
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatching: (() => void) | null = null

  /**
   * 一張表的推送＋拉取＋合併。合併故意讀 `readLocal()`（呼叫當下的最新值），
   * 不是進函式當時就固定住的參數——中間有兩次網路等待，這段時間本地如果
   * 發生「整份陣列替換」式的操作（remove／batchUpdate／undo…），合併時
   * 用一份舊快照當基準會把那個操作靜靜蓋掉。細節見 sync/tableSync.ts 開頭。
   *
   * `applyMerge()` 只在真的有東西要改（遠端贏了某幾列、或遠端回報刪除）
   * 時才呼叫——這裡曾經是無條件呼叫，就算這一輪遠端完全沒有變化，
   * `mergeByUpdatedAt` 仍然回傳一個內容相同、但參照不同的新陣列，把它
   * 寫回 `tasks.items`／`collections.*` 一樣會觸發下面 `start()` 那個
   * 「本地編輯」防抖 watcher（它分不出這次陣列替換是使用者剛編輯的，
   * 還是同步自己寫回去的），排出下一次推送。下一次推送又是同一輪
   * 「沒變化 → 還是整批寫回 → 又觸發 watcher」，整個同步引擎因此陷入
   * 每 PUSH_DEBOUNCE_MS 就自己觸發一次的無窮迴圈，完全繞過原本設計的
   * PULL_INTERVAL_MS 輪詢間隔——多打的每一次網路請求都是純粹浪費，
   * 一直安靜地跑不會有錯誤訊息，只是在背景持續打 API。是寫這次的
   * flushPendingPush() 回歸測試時才發現的：一輪同步剛跑完，照理不該有
   * 任何「還沒送出的變更」，但 pushTimer 卻總是掛著。
   */
  async function syncOneTable<T extends { id: string; updatedAt: number }>(
    binding: TableBinding<T>,
    readLocal: () => readonly T[],
    fingerprintKey: keyof Fingerprints,
    cursor: number,
    token: string,
    applyMerge: (rows: T[]) => void,
  ): Promise<void> {
    const fingerprint = fingerprints[fingerprintKey] as Map<string, string>
    const pushedFingerprint = await pushTable(binding, readLocal(), fingerprint, token)
    const { live, deletedIds } = await pullTable(binding, cursor, token)

    // 兩次網路呼叫都結束了，這裡才第一次讀「現在」的本地狀態來合併——
    // 跟上面那次 readLocal() 之間完全沒有 await，不會有時間差。
    const merge = mergeByUpdatedAt(readLocal(), live, deletedIds)
    if (merge.remoteWon.length > 0 || merge.removedIds.length > 0) applyMerge(merge.merged)
    for (const row of merge.remoteWon) pushedFingerprint.set(row.id, JSON.stringify(row))
    for (const id of merge.removedIds) pushedFingerprint.delete(id)

    fingerprints = { ...fingerprints, [fingerprintKey]: pushedFingerprint }
  }

  async function persist(): Promise<void> {
    await setMeta(META_SYNC_LAST_PULLED_AT, lastPulledAt.value)
    await Promise.all([
      saveFingerprint(META_SYNC_FINGERPRINT_TASKS, fingerprints.tasks),
      saveFingerprint(META_SYNC_FINGERPRINT_PROJECTS, fingerprints.projects),
      saveFingerprint(META_SYNC_FINGERPRINT_TAGS, fingerprints.tags),
      saveFingerprint(META_SYNC_FINGERPRINT_FILTERS, fingerprints.filters),
    ])
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

          await syncOneTable(taskBinding, () => tasks.items, 'tasks', cursor, token, tasks.mergeRemote)
          await syncOneTable(
            projectBinding,
            () => collections.projects,
            'projects',
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: rows, tags: collections.tags, filters: collections.filters }),
          )
          await syncOneTable(
            tagBinding,
            () => collections.tags,
            'tags',
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: collections.projects, tags: rows, filters: collections.filters }),
          )
          await syncOneTable(
            filterBinding,
            () => collections.filters,
            'filters',
            cursor,
            token,
            (rows) => collections.mergeRemote({ projects: collections.projects, tags: collections.tags, filters: rows }),
          )

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
   * 的同步游標與指紋）從頭到尾沒有依「目前登入的是誰」分區——這是刻意的
   * 離線優先設計：`stores/auth.ts` 的 `signOut()` 明確不清本地資料，
   * 這裡的 `stop()` 也一樣。但這只涵蓋了「同一個人換裝置」，沒有涵蓋
   * 「同一台裝置／瀏覽器換了不同的人登入」——這種情況下，新登入的帳號會
   * 直接繼承、甚至把上一個帳號留在本機的資料當成自己的推送上去，是真正
   * 的資料隔離缺陷，不是單純的畫面顯示問題：使用者會看到不屬於自己的
   * 待辦內容，而且只要在那個狀態下編輯任何一筆，就會嘗試用自己的帳號
   * 去 upsert 一筆 id 屬於另一個使用者的遠端列。
   *
   * 做法比照業界慣例（Google Drive／Dropbox 換帳號登入時的處理）：本地
   * 額外記一把「這份快取上次是跟哪個 user id 對過帳」（`META_SYNC_ACCOUNT_ID`）。
   * 登入時發現跟上次不同，代表這份本地快取邏輯上不屬於新使用者，直接
   * 清空（`mergeRemote([])`／`mergeRemote({ projects: [], tags: [], filters: [] })`
   * ——跟遠端合併結果套用是同一條路徑，不特別記一筆復原命令，理由跟
   * `tasks.ts` 的 `mergeRemote` 一致：這不是使用者在這台裝置上剛做的操作）
   * 並把游標歸零、指紋清空——下一輪同步會用乾淨狀態完整拉一次新帳號在
   * 伺服器上真正的資料，不會有任何本地殘留被誤判成新帳號的內容，也不會
   * 有本地殘留被誤推到新帳號名下。
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
      lastPulledAt.value = 0
      fingerprints = { tasks: new Map(), projects: new Map(), tags: new Map(), filters: new Map() }
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
    fingerprints = {
      tasks: await loadFingerprint(META_SYNC_FINGERPRINT_TASKS),
      projects: await loadFingerprint(META_SYNC_FINGERPRINT_PROJECTS),
      tags: await loadFingerprint(META_SYNC_FINGERPRINT_TAGS),
      filters: await loadFingerprint(META_SYNC_FINGERPRINT_FILTERS),
    }
    // 同一個理由再檢查一次：上面四次 fingerprint 讀取都是各自獨立的
    // await，stop() 一樣可能發生在其中任何一次之間。
    if (!enabled.value) return

    void syncOnce()
    interval = setInterval(() => void syncOnce(), PULL_INTERVAL_MS)
    window.addEventListener('online', onReconnectOrFocus)
    document.addEventListener('visibilitychange', onReconnectOrFocus)

    stopWatching = watch(
      [() => tasks.items, () => collections.projects, () => collections.tags, () => collections.filters],
      () => {
        if (pushTimer) clearTimeout(pushTimer)
        pushTimer = setTimeout(() => void syncOnce(), PUSH_DEBOUNCE_MS)
      },
      { deep: true },
    )
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
