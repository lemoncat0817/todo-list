import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { makeTask } from '@/test/helpers'
import { getMeta } from '@/db'
import { META_SYNC_LAST_PULLED_AT } from '@/db/schema'

/**
 * stores/sync.ts 的協調邏輯。真正的網路層（restClient）與純合併規則
 * （merge.ts／tableSync.ts）已經各自測過，這裡驗證的是「協調」本身：
 * 沒 token 時安靜跳過、觸發時機（interval／debounce）、以及最容易出錯的
 * 一點——合併時讀的是不是「現在」的本地狀態，而不是呼叫當下的舊快照。
 */
let activeSync: ReturnType<typeof useSyncStore> | null = null

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const app = { sync: useSyncStore(), auth: useAuthStore(), tasks: useTasksStore(), collections: useCollectionsStore() }
  activeSync = app.sync
  return app
}

function fakeSession(token = 'token-123'): Session {
  return {
    access_token: token,
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1' },
  } as unknown as Session
}

/** 預設回應空清單，讓 pull 沒有東西可拉，測試才能專注在協調邏輯本身。 */
function mockFetch(impl?: (url: string, options: RequestInit) => Promise<unknown> | unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const body = impl ? await impl(String(url), options as RequestInit) : []
    return { ok: true, json: async () => body } as Response
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  // 沒有明確 stop() 的話，setInterval 是真正的 JS 計時器，不會隨著測試結束
  // 或 Pinia store 被丟棄而自動消失——之前就是這樣讓下一輪測試在背景
  // 收到一次真正的網路呼叫（連到不存在的 127.0.0.1:3000）。
  activeSync?.stop()
  activeSync = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('未登入時', () => {
  it('start() 不會丟出例外，也不會設定 syncError——只是安靜地什麼都不做', async () => {
    const { sync } = setup()
    mockFetch()
    await sync.start()
    await nextTick()
    expect(sync.syncError).toBeNull()
  })
})

describe('已登入時', () => {
  it('start() 立刻跑一次同步，並把游標存進 IndexedDB 的 meta', async () => {
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    mockFetch()

    await sync.start()
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })
    expect(sync.syncError).toBeNull()
  })

  it('網路失敗時記錄 syncError，本地狀態不受影響', async () => {
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    tasks.items = [makeTask('本地的事', false, { id: 't1' })]
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).not.toBeNull())

    expect(tasks.items.map((t) => t.id)).toEqual(['t1'])
  })

  it('合併讀的是「現在」的本地狀態，不是呼叫當下的舊快照', async () => {
    // 這一條釘住 sync.ts 修過的一個真實問題：push 送出後、pull 回來前有一段
    // 網路等待，如果合併用的是進函式時就讀好的舊陣列，這段等待期間使用者
    // 若剛好做了「整份陣列替換」式的操作（remove／batchUpdate／undo…），
    // 合併結果蓋回去時會把那個操作靜靜蓋掉，使用者完全不會發現。
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    tasks.items = [makeTask('會被留著的', false, { id: 'keep' }), makeTask('會被刪掉的', false, { id: 'drop' })]
    await nextTick()
    await tasks.flush()

    let pullCount = 0
    mockFetch(async (_url, options) => {
      if (options.method === 'GET') {
        pullCount++
        if (pullCount === 1) {
          // 第一次 pull（tasks 表）進行中，模擬使用者在這段網路等待期間
          // 做了一個「整份陣列替換」式的本地刪除
          tasks.remove('drop')
        }
      }
      return []
    })

    await sync.start()
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })
    expect(sync.syncError).toBeNull()
    expect(tasks.items.map((t) => t.id)).toEqual(['keep'])
  })

  it('stop() 之後本地資料原封不動——只斷開同步，不清資料', async () => {
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    tasks.items = [makeTask('留著', false, { id: 't1' })]
    mockFetch()

    await sync.start()
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })
    sync.stop()

    expect(sync.enabled).toBe(false)
    expect(tasks.items.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('auth.status 驅動 start／stop', () => {
  /**
   * start()／stop() 不再由呼叫端（main.ts、AccountDialog.vue）手動呼叫，
   * 而是這個 store 自己 watch auth.status——這樣不管登入是在哪個分頁、
   * 用哪種方式（信箱連結、跨分頁廣播、OAuth、開機還原）完成的都涵蓋得到，
   * 不會漏掉「登入完成，但沒有任何程式碼記得呼叫 start()」的情況。
   */
  it('auth.status 變成 signed-in 時自動開始同步，不需要手動呼叫 start()', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    mockFetch()

    expect(sync.enabled, '一開始沒登入，不該自動啟動').toBe(false)

    auth.session = fakeSession()
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(sync.enabled).toBe(true))
  })

  it('auth.status 變回 signed-out 時自動停止，不需要手動呼叫 stop()', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    mockFetch()

    auth.session = fakeSession()
    auth.status = 'signed-in'
    await vi.waitFor(() => expect(sync.enabled).toBe(true))

    auth.session = null
    auth.status = 'signed-out'
    await vi.waitFor(() => expect(sync.enabled).toBe(false))
  })
})

describe('觸發時機', () => {
  /**
   * 只讓 setTimeout／setInterval 變成假的，不動到 Date 或微任務排程——
   * fake-indexeddb 的事件派送依賴後者，兩者混在一起會讓 IndexedDB 的
   * 操作永遠等不到回呼。所以 start() 本身（含讀 IndexedDB 的 meta）
   * 一律在真實計時器下先跑完、確認穩定，才切換成假計時器測防抖／間隔。
   */
  async function startWithRealTimers() {
    const app = setup()
    app.auth.session = fakeSession()
    app.tasks.isLoading = false
    const fetchMock = mockFetch()

    await app.sync.start()
    // syncError 預設就是 null，不能拿來確認「第一輪同步真的跑完了」；
    // lastPulledAt 只在整輪（四張表都推送＋拉取完成）結束時才會被寫入，
    // 才是可靠的完成訊號。
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toEqual(expect.any(Number))
    })
    fetchMock.mockClear()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    return { ...app, fetchMock }
  }

  it('本地編輯會在防抖時間後觸發同步，不是每次變動都立刻打', async () => {
    const { tasks, fetchMock } = await startWithRealTimers()

    tasks.items = [makeTask('新的', false, { id: 't1' })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock, '防抖時間還沒到').not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)
    expect(fetchMock, '防抖時間到了才打').toHaveBeenCalled()
  })

  it('stop() 之後計時器都被清掉，之後的本地編輯不會再觸發同步', async () => {
    const { sync, tasks, fetchMock } = await startWithRealTimers()
    sync.stop()
    fetchMock.mockClear()

    tasks.items = [makeTask('停止後才改的', false, { id: 't1' })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
