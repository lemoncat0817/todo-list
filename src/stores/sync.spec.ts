import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import { useSyncStore } from '@/stores/sync'
import { useAuthStore } from '@/stores/auth'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { makeTask } from '@/test/helpers'
import { getMeta, setMeta } from '@/db'
import { META_SYNC_ACCOUNT_ID, META_SYNC_LAST_PULLED_AT } from '@/db/schema'

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

function fakeSession(token = 'token-123', userId = 'u1'): Session {
  return {
    access_token: token,
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
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

  /**
   * 對應 stores/sync.ts 的 describeSyncError()——這裡曾經是真實的問題：
   * syncError 直接存 error.message，把 PostgREST 的原始錯誤 JSON、資料表
   * 名稱、HTTP 狀態碼整包顯示在 AccountDialog.vue／AppSidebar.vue 上
   * （使用者實際回報過看到這種訊息）。畫面上該只留使用者看得懂、
   * 不誤導的說法，技術細節改用 console.error 留給開發者查。
   */
  it('伺服器拒絕請求時，畫面上看到的是友善說法，不是原始的 HTTP／PostgREST 錯誤內容', async () => {
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    tasks.items = [makeTask('要送出的', false, { id: 't1' })]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"code":"PGRST102","details":null,"hint":null,"message":"All object keys must match"}',
    } as Response)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).not.toBeNull())

    expect(sync.syncError).toBe('伺服器暫時無法處理，稍後會自動重試')
    expect(sync.syncError).not.toContain('PGRST102')
    expect(sync.syncError).not.toContain('tasks')
    expect(sync.syncError).not.toContain('400')
  })

  it('連不上網路時顯示對應的說法，不是瀏覽器原生的 fetch 錯誤訊息', async () => {
    const { sync, auth, tasks } = setup()
    auth.session = fakeSession()
    tasks.isLoading = false
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await sync.start()
    await vi.waitFor(() => expect(sync.syncError).not.toBeNull())

    expect(sync.syncError).toBe('目前連不上網路，恢復連線後會自動重試')
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

  /**
   * flushPendingPush()：main.ts 在 pagehide／visibilitychange(hidden) 時呼叫，
   * 補的是「編輯完（包括刪除）立刻關分頁，防抖計時器還沒到就沒送出去」
   * 這個空窗——本地 IndexedDB 已經改好了，但伺服器上那幾筆還是舊的，
   * 下次同步回來就會像是「已經刪除的東西又出現了」。
   */
  it('防抖計時器還掛著時，flushPendingPush 立刻送出這次變更，不等防抖時間到', async () => {
    const { sync, tasks, fetchMock } = await startWithRealTimers()

    tasks.items = [makeTask('要立刻補送的', false, { id: 't1' })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock, '防抖時間（3000ms）還沒到，正常情況下還不會送出').not.toHaveBeenCalled()

    await sync.flushPendingPush()

    expect(fetchMock, '模擬頁面正要關閉，應該立刻送出，不能繼續等防抖').toHaveBeenCalled()
  })

  it('沒有還沒送出的變更時，flushPendingPush 是 no-op，不多打一次網路請求', async () => {
    const { sync, fetchMock } = await startWithRealTimers()

    await sync.flushPendingPush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('遠端這輪完全沒有變化時，不重寫本地陣列、也不會自己排下一次推送', async () => {
    // 釘住 syncOneTable 修過的問題：以前不管遠端有沒有變化都無條件呼叫
    // applyMerge()，內容相同但參照不同的新陣列一樣會觸發下面這個防抖
    // watcher，讓同步引擎每 3 秒自己觸發一次、完全繞過 30 秒輪詢間隔。
    const { sync, tasks, fetchMock } = await startWithRealTimers()
    const itemsBeforePoll = tasks.items

    // 用固定間隔（PULL_INTERVAL_MS）模擬下一次輪詢，這一輪 mock 回應
    // 仍然是空陣列——遠端沒有任何變化。
    await vi.advanceTimersByTimeAsync(30_000)

    expect(tasks.items, '沒有東西要合併時不該重寫陣列參照').toBe(itemsBeforePoll)
    fetchMock.mockClear()
    await sync.flushPendingPush()
    expect(fetchMock, '這一輪沒有變化，不該有 pushTimer 掛著、也不該自己排出下一次推送').not.toHaveBeenCalled()
  })
})

describe('帳號隔離：換了不同的人登入時，本地快取不能繼續冒充新使用者的資料', () => {
  /**
   * 對應 stores/sync.ts 的 reconcileAccountIdentity()——修的是這個真實情境：
   * A 在這台裝置登入過、同步過，登出（signOut 刻意不清本地資料）；
   * B 在同一台裝置登入。沒有這段邏輯的話，B 會直接看到 A 留下的任務，
   * B 一旦編輯任何一筆還會用自己的 token 把「A 的資料」upsert 到遠端。
   */
  it('本地記錄的 owner 跟這次登入的 user id 不同時，清空本地任務／專案／標籤／篩選器並把游標歸零', async () => {
    const { sync, auth, tasks, collections } = setup()
    await setMeta(META_SYNC_ACCOUNT_ID, 'userA')
    tasks.isLoading = false
    tasks.items = [makeTask('A 的任務', false, { id: 'a-task' })]
    collections.projects = [
      { id: 'a-proj', name: 'A 的專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false },
    ]
    collections.tags = [{ id: 'a-tag', name: 'A 的標籤', color: '#000', updatedAt: 1 }]
    collections.filters = [{ id: 'a-filter', name: 'A 的篩選', query: '', color: '#000', rank: 'A', updatedAt: 1 }]
    const fetchMock = mockFetch()

    auth.session = fakeSession('token-b', 'userB')
    await sync.start()

    expect(tasks.items, '不該讓 B 看到 A 留下的任務').toEqual([])
    expect(collections.projects).toEqual([])
    expect(collections.tags).toEqual([])
    expect(collections.filters).toEqual([])
    await vi.waitFor(async () => {
      expect(await getMeta<string>(META_SYNC_ACCOUNT_ID)).toBe('userB')
    })
    // 等第一輪同步真的跑完（lastPulledAt 從 reconcile 寫入的 0 前進到真正的
    // 時間戳），才去檢查這輪拉取實際打出去的請求——避免跟 fire-and-forget
    // 的 syncOnce() 有時間差。
    await vi.waitFor(async () => {
      expect(await getMeta<number>(META_SYNC_LAST_PULLED_AT)).toBeGreaterThan(0)
    })
    // 換人登入後的第一輪拉取要用游標 0（不是 A 留下的舊游標），
    // 才會完整拉一次 B 在伺服器上真正的資料，不會漏掉比 A 的舊游標更早的列。
    const getCalls = fetchMock.mock.calls.filter(([, options]) => (options as RequestInit).method === 'GET')
    expect(getCalls.length, '四張表都要重新拉一次').toBe(4)
    for (const [url] of getCalls) {
      expect(String(url)).toContain('updated_at=gt.0')
    }
  })

  it('同一個人重新登入（同一個 user id）不會被當成換人，本地資料原封不動', async () => {
    const { sync, auth, tasks } = setup()
    await setMeta(META_SYNC_ACCOUNT_ID, 'userA')
    tasks.isLoading = false
    tasks.items = [makeTask('A 自己的任務', false, { id: 'a-task' })]
    mockFetch()

    auth.session = fakeSession('token-a-again', 'userA')
    await sync.start()
    await nextTick()

    expect(tasks.items.map((t) => t.id)).toEqual(['a-task'])
  })

  it('本地從沒記錄過 owner（全新安裝或第一次登入）時不清空既有本地資料——維持既有的「登入後把本地資料併進帳號」行為', async () => {
    const { sync, auth, tasks } = setup()
    tasks.isLoading = false
    tasks.items = [makeTask('登入前就存在的本地任務', false, { id: 'local-only' })]
    mockFetch()

    auth.session = fakeSession()
    await sync.start()
    await nextTick()

    expect(tasks.items.map((t) => t.id)).toEqual(['local-only'])
    await vi.waitFor(async () => {
      expect(await getMeta<string>(META_SYNC_ACCOUNT_ID)).toBe('u1')
    })
  })
})
