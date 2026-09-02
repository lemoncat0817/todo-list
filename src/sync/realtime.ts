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
  /** RealtimeClient 需要在每次連線／重連時取得目前有效的 token，不是只在建立當下讀一次。 */
  getAccessToken: () => Promise<string | null>
  /** 這個工作區的四張表有任何變更時觸發（已去抖動）。 */
  onChange: () => void
  /** 每次成功連上（含首次與每次重連）都會呼叫一次。 */
  onSubscribed: () => void
  onStatusChange?: (status: RealtimeStatus) => void
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
  const channel: RealtimeChannel = rt.channel(`workspace:${opts.workspaceId}`)

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

  channel.subscribe((status) => {
    opts.onStatusChange?.(mapStatus(status))
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) opts.onSubscribed()
  })

  return {
    stop: () => {
      clearTimeout(debounceTimer)
      void channel.unsubscribe()
    },
  }
}

/** 測試與登出時用：關掉共用連線，讓下次呼叫重新建立。 */
export function resetRealtimeClient(): void {
  void client?.disconnect()
  client = null
}
