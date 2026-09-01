import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { getMeta, setMeta } from '@/db'
import {
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
 * 跨裝置同步的協調層。
 *
 * 依賴方向是 sync → tasks／collections／auth，不是反過來：tasks.ts／
 * collections.ts 完全不知道同步這件事存在，這裡自己 watch 它們的狀態，
 * 跟 tasks.ts 自己 watch 本地狀態去寫 IndexedDB 是同一個模式，只是這裡
 * 寫的目的地是遠端。這樣沒有帳號的使用者，tasks.ts／collections.ts
 * 一行都不用因為同步而改變。
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
    applyMerge(merge.merged)
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
        syncError.value = error instanceof Error ? error.message : String(error)
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

  /** 呼叫端（AccountDialog）在登入成功後呼叫；main.ts 在還原既有 session 成功後也會呼叫。 */
  async function start(): Promise<void> {
    if (enabled.value) return
    enabled.value = true
    syncError.value = null

    lastPulledAt.value = (await getMeta<number>(META_SYNC_LAST_PULLED_AT)) ?? 0
    fingerprints = {
      tasks: await loadFingerprint(META_SYNC_FINGERPRINT_TASKS),
      projects: await loadFingerprint(META_SYNC_FINGERPRINT_PROJECTS),
      tags: await loadFingerprint(META_SYNC_FINGERPRINT_TAGS),
      filters: await loadFingerprint(META_SYNC_FINGERPRINT_FILTERS),
    }

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

  return { enabled, syncError, lastPulledAt, start, stop }
})
