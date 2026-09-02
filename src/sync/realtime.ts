import { RealtimeClient, REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/realtime-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * Realtime 訂閱：把「輪詢間隔壓到即時」這件事跟「怎麼套用資料」分開。
 *
 * 這個模組只負責「這個工作區有東西變了，去補拉一次」跟「(重新)連上了，
 * 補拉一次游標之後的資料」兩個訊號，不解析 postgres_changes 帶回來的
 * payload、不直接寫 IndexedDB——套用資料永遠走既有的
 * pull-since-cursor + mergeByUpdatedAt 那條路（sync/tableSync.ts、
 * sync/merge.ts），這樣不需要為了 realtime 的即時事件另外重寫一套
 * RLS／墓碑／衝突處理邏輯，realtime 純粹是「提早戳一下」。
 *
 * 斷線重連由 RealtimeClient 自己的 socket 層處理（內建退避），重新
 * join 頻道時 subscribe() 的 callback 會再收到一次 SUBSCRIBED——不需要
 * 在這裡手刻重試機制。
 *
 * 動態載入：跟 sync/authClient.ts 一樣，這個模組本身沒有頂層副作用，
 * 只有呼叫 subscribeToWorkspace() 才會真的連線；只在使用者實際進入
 * 已設定 Supabase 的工作區時，由 stores/sync.ts `import()` 這個檔案，
 * 單機使用者完全不會下載到 @supabase/realtime-js。
 */

/** 一連串變更事件在這段時間內只觸發一次 onChange，避免一串編輯戳出一串補拉請求。 */
const CHANGE_DEBOUNCE_MS = 500

/** 目前有資料表的四張表；日後（留言、附件）新增了同步表再加進來。 */
const WATCHED_TABLES = ['tasks', 'projects', 'tags', 'filters'] as const

export type RealtimeStatus = 'subscribed' | 'disconnected' | 'error'

export interface WorkspaceSubscription {
  /** 停止訂閱並釋放頻道。呼叫端在離開工作區／登出時呼叫。 */
  stop: () => void
}

export interface SubscribeOptions {
  workspaceId: string
  userId: string
  /** RealtimeClient 需要在每次連線／重連時取得目前有效的 token，不是只在建立當下讀一次。 */
  getAccessToken: () => Promise<string | null>
  /** 這個工作區的四張表有任何變更時觸發（已去抖動）。 */
  onChange: () => void
  /** 每次成功連上（含首次與每次重連）都會呼叫一次。 */
  onSubscribed: () => void
  onStatusChange?: (status: RealtimeStatus) => void
  /**
   * 這個工作區目前線上的 user id 集合有變動時觸發（成員上線／下線、
   * 或剛連上時的初始快照）。M3 的線上狀態——見下方 presence 區塊的說明。
   */
  onPresenceChange?: (userIds: readonly string[]) => void
}

let client: RealtimeClient | null = null

/** 全域只需要一個 socket 連線，多個工作區的頻道共用它——RealtimeClient 本身就是為這個設計的。 */
function getClient(getAccessToken: () => Promise<string | null>): RealtimeClient {
  if (!client) {
    client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
      params: { apikey: SUPABASE_ANON_KEY },
      accessToken: getAccessToken,
    })
  }
  return client
}

function mapStatus(status: REALTIME_SUBSCRIBE_STATES): RealtimeStatus {
  if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return 'subscribed'
  if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) return 'disconnected'
  return 'error'
}

export function subscribeToWorkspace(opts: SubscribeOptions): WorkspaceSubscription {
  const rt = getClient(opts.getAccessToken)
  // presence.key 決定 presenceState() 的 key 是什麼——不設的話預設是每個
  // 連線各自的亂數識別碼，不是 user_id，onPresenceChange 會拿到一堆看不懂
  // 的字串而不是使用者名單。同一個人開兩個分頁／裝置會共用同一個 key，
  // 疊成同一個線上狀態，這正是「這個人在線上」而不是「這個連線在線上」
  // 該有的語意。
  const channel: RealtimeChannel = rt.channel(`workspace:${opts.workspaceId}`, {
    config: { presence: { key: opts.userId } },
  })

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  const notifyChange = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(opts.onChange, CHANGE_DEBOUNCE_MS)
  }

  for (const table of WATCHED_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `workspace_id=eq.${opts.workspaceId}` },
      notifyChange,
    )
  }

  /**
   * 線上狀態（M3）。跟上面的 postgres_changes 是兩種機制：那邊拉的是
   * 「資料庫裡的資料變了」，這裡是「誰現在開著這個工作區」——track() 送出的
   * 只有 user_id／online_at，不經過資料庫，也不受任何一張表的 RLS 保護。
   *
   * 頻道名稱（workspace:${workspaceId}）本身不是私有頻道（沒有另外設定
   * Realtime 的 Authorization for Presence／Broadcast），知道這個工作區
   * UUID 的人理論上都能訂閱到這裡的線上狀態——UUID 不是容易被外部猜到的
   * 值，而且暴露的只是「這幾個 user id 現在在線上」，不是任務內容，這裡
   * 接受這個已知、範圍很小的取捨，不是沒注意到。真的需要私有頻道等級的
   * 保護時，Realtime 有 RLS-based 的頻道授權機制可以加，這裡先不做。
   */
  if (opts.onPresenceChange) {
    const onPresenceChange = opts.onPresenceChange
    channel.on('presence', { event: 'sync' }, () => {
      onPresenceChange(Object.keys(channel.presenceState()))
    })
  }

  channel.subscribe((status) => {
    opts.onStatusChange?.(mapStatus(status))
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      opts.onSubscribed()
      void channel.track({ user_id: opts.userId, online_at: new Date().toISOString() })
    }
  })

  return {
    stop: () => {
      clearTimeout(debounceTimer)
      void channel.untrack()
      void channel.unsubscribe()
    },
  }
}

/** 測試與登出時用：關掉共用連線，讓下次呼叫重新建立。 */
export function resetRealtimeClient(): void {
  void client?.disconnect()
  client = null
}
