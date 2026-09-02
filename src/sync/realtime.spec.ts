import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/realtime-js'

/**
 * 假的 RealtimeChannel／RealtimeClient：只還原這個模組實際用到的介面
 * （channel/on/subscribe/unsubscribe/disconnect/track/untrack/
 * presenceState），不是整個套件的行為。
 */
class FakeChannel {
  handlers: Array<{ table: string; cb: () => void }> = []
  presenceHandlers: Array<() => void> = []
  subscribeCb: ((status: REALTIME_SUBSCRIBE_STATES) => void) | undefined
  unsubscribed = false
  trackCalls: Record<string, unknown>[] = []
  untrackCalls = 0
  /** 測試用：下一次 emitPresenceSync() 要讓 presenceState() 回傳的內容。 */
  fakePresenceState: Record<string, unknown> = {}

  on(type: string, filter: { table?: string; event?: string }, cb: () => void) {
    if (type === 'presence') {
      this.presenceHandlers.push(cb)
    } else {
      this.handlers.push({ table: filter.table ?? '', cb })
    }
    return this
  }

  subscribe(cb: (status: REALTIME_SUBSCRIBE_STATES) => void) {
    this.subscribeCb = cb
    return this
  }

  unsubscribe() {
    this.unsubscribed = true
    return Promise.resolve('ok')
  }

  track(payload: Record<string, unknown>) {
    this.trackCalls.push(payload)
    return Promise.resolve('ok')
  }

  untrack() {
    this.untrackCalls++
    return Promise.resolve('ok')
  }

  presenceState() {
    return this.fakePresenceState
  }

  /** 測試用：模擬伺服器推來的狀態變化。 */
  emitStatus(status: REALTIME_SUBSCRIBE_STATES) {
    this.subscribeCb?.(status)
  }

  /** 測試用：模擬某張表有一筆變更事件送達。 */
  emitChange(table: string) {
    for (const h of this.handlers) if (h.table === table) h.cb()
  }

  /** 測試用：模擬 presence 同步事件送達，presenceState() 之後回傳 nextState。 */
  emitPresenceSync(nextState: Record<string, unknown>) {
    this.fakePresenceState = nextState
    for (const h of this.presenceHandlers) h()
  }
}

let lastChannel: FakeChannel | null = null
let disconnectCalls = 0

vi.mock('@supabase/realtime-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/realtime-js')>()
  return {
    ...actual,
    RealtimeClient: class FakeRealtimeClient {
      channel() {
        lastChannel = new FakeChannel()
        return lastChannel
      }
      disconnect() {
        disconnectCalls++
        return Promise.resolve('ok')
      }
    },
  }
})

const { subscribeToWorkspace, subscribeToTaskPresence, resetRealtimeClient } = await import('./realtime')

beforeEach(() => {
  vi.useFakeTimers()
  lastChannel = null
  // 上一個測試可能留下一個還沒關閉的 client——resetRealtimeClient() 本身
  // 會呼叫 disconnect()，這筆呼叫屬於「清理上一個測試」，不能算進這個
  // 測試自己的斷言，所以歸零計數器要放在它之後。
  resetRealtimeClient()
  disconnectCalls = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('subscribeToWorkspace', () => {
  it('連上時（含每次重連）都呼叫 onSubscribed', () => {
    const onSubscribed = vi.fn()
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed,
    })

    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    expect(onSubscribed).toHaveBeenCalledTimes(1)

    // 斷線重連：SUBSCRIBED 再來一次，onSubscribed 也該再觸發一次
    // （這就是「重新連上時補拉一次游標之後的資料」的觸發點）。
    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.CLOSED)
    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    expect(onSubscribed).toHaveBeenCalledTimes(2)
  })

  it('onStatusChange 回報對應的狀態', () => {
    const onStatusChange = vi.fn()
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
      onStatusChange,
    })

    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.CLOSED)
    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR)

    expect(onStatusChange.mock.calls.map((c) => c[0])).toEqual(['subscribed', 'disconnected', 'error'])
  })

  it('訂閱目前已知的四張表，且帶上 workspace_id 的過濾條件', () => {
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
    })

    expect(lastChannel?.handlers.map((h) => h.table).sort()).toEqual(['filters', 'projects', 'tags', 'tasks'])
  })

  it('短時間內多個變更事件去抖動成一次 onChange', () => {
    const onChange = vi.fn()
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange,
      onSubscribed: vi.fn(),
    })

    lastChannel?.emitChange('tasks')
    lastChannel?.emitChange('tasks')
    lastChannel?.emitChange('projects')
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('去抖動視窗過後又有新事件，會再觸發一次 onChange', () => {
    const onChange = vi.fn()
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange,
      onSubscribed: vi.fn(),
    })

    lastChannel?.emitChange('tasks')
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(1)

    lastChannel?.emitChange('tasks')
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('stop() 取消訂閱並清掉還沒觸發的去抖動計時器', () => {
    const onChange = vi.fn()
    const sub = subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange,
      onSubscribed: vi.fn(),
    })

    lastChannel?.emitChange('tasks')
    sub.stop()
    vi.advanceTimersByTime(500)

    expect(onChange).not.toHaveBeenCalled()
    expect(lastChannel?.unsubscribed).toBe(true)
  })

  it('resetRealtimeClient() 會斷線並讓下次訂閱重新建立連線', () => {
    subscribeToWorkspace({
      workspaceId: 'w1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
    })
    const first = lastChannel

    resetRealtimeClient()
    expect(disconnectCalls).toBe(1)

    subscribeToWorkspace({
      workspaceId: 'w2',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
    })
    expect(lastChannel).not.toBe(first)
  })

  describe('線上狀態（presence）', () => {
    it('連上時用自己的 user id 呼叫 track()，讓其他訂閱者看得到自己在線上', () => {
      subscribeToWorkspace({
        workspaceId: 'w1',
        userId: 'u1',
        getAccessToken: async () => 'token',
        onChange: vi.fn(),
        onSubscribed: vi.fn(),
      })

      lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)

      expect(lastChannel?.trackCalls).toHaveLength(1)
      expect(lastChannel?.trackCalls[0]).toMatchObject({ user_id: 'u1' })
    })

    it('presence 同步事件送達時，onPresenceChange 收到目前線上的 user id 清單', () => {
      const onPresenceChange = vi.fn()
      subscribeToWorkspace({
        workspaceId: 'w1',
        userId: 'u1',
        getAccessToken: async () => 'token',
        onChange: vi.fn(),
        onSubscribed: vi.fn(),
        onPresenceChange,
      })

      lastChannel?.emitPresenceSync({
        u1: [{ presence_ref: 'ref1', user_id: 'u1' }],
        u2: [{ presence_ref: 'ref2', user_id: 'u2' }],
      })

      expect(onPresenceChange).toHaveBeenCalledWith(['u1', 'u2'])
    })

    it('沒有傳 onPresenceChange 時不註冊 presence 監聽——不需要的呼叫端不用付這個成本', () => {
      subscribeToWorkspace({
        workspaceId: 'w1',
        userId: 'u1',
        getAccessToken: async () => 'token',
        onChange: vi.fn(),
        onSubscribed: vi.fn(),
      })

      expect(lastChannel?.presenceHandlers).toHaveLength(0)
    })

    it('stop() 會呼叫 untrack()，讓自己從其他訂閱者的線上清單消失', () => {
      const sub = subscribeToWorkspace({
        workspaceId: 'w1',
        userId: 'u1',
        getAccessToken: async () => 'token',
        onChange: vi.fn(),
        onSubscribed: vi.fn(),
      })

      sub.stop()

      expect(lastChannel?.untrackCalls).toBe(1)
    })
  })
})

describe('subscribeToTaskPresence', () => {
  it('連上時用自己的 user id、目前聚焦欄位（一開始是 null）呼叫 track()', () => {
    subscribeToTaskPresence({
      taskId: 't1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
    })

    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)

    expect(lastChannel?.trackCalls).toHaveLength(1)
    expect(lastChannel?.trackCalls[0]).toEqual({ user_id: 'u1', focused_field: null })
  })

  it('updateFocus() 用新的聚焦欄位重新 track()', () => {
    const sub = subscribeToTaskPresence({
      taskId: 't1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
    })
    lastChannel?.emitStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)

    sub.updateFocus('taskName')

    expect(lastChannel?.trackCalls.at(-1)).toEqual({ user_id: 'u1', focused_field: 'taskName' })
  })

  it('presence 同步事件送達時，onChange 收到除了自己以外的檢視者', () => {
    const onChange = vi.fn()
    subscribeToTaskPresence({
      taskId: 't1',
      userId: 'me',
      getAccessToken: async () => 'token',
      onChange,
    })

    lastChannel?.emitPresenceSync({
      me: [{ presence_ref: 'ref1', user_id: 'me', focused_field: null }],
      bob: [{ presence_ref: 'ref2', user_id: 'bob', focused_field: 'notes' }],
    })

    expect(onChange).toHaveBeenCalledWith([{ userId: 'bob', focusedField: 'notes' }])
  })

  it('stop() 會 untrack 並取消訂閱', () => {
    const sub = subscribeToTaskPresence({
      taskId: 't1',
      userId: 'u1',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
    })

    sub.stop()

    expect(lastChannel?.untrackCalls).toBe(1)
    expect(lastChannel?.unsubscribed).toBe(true)
  })
})
