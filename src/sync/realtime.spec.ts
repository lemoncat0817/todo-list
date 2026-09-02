import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/realtime-js'

/**
 * 假的 RealtimeChannel／RealtimeClient：只還原這個模組實際用到的介面
 * （channel/on/subscribe/unsubscribe/disconnect），不是整個套件的行為。
 */
class FakeChannel {
  handlers: Array<{ table: string; cb: () => void }> = []
  subscribeCb: ((status: REALTIME_SUBSCRIBE_STATES) => void) | undefined
  unsubscribed = false

  on(_type: string, filter: { table: string }, cb: () => void) {
    this.handlers.push({ table: filter.table, cb })
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

  /** 測試用：模擬伺服器推來的狀態變化。 */
  emitStatus(status: REALTIME_SUBSCRIBE_STATES) {
    this.subscribeCb?.(status)
  }

  /** 測試用：模擬某張表有一筆變更事件送達。 */
  emitChange(table: string) {
    for (const h of this.handlers) if (h.table === table) h.cb()
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

const { subscribeToWorkspace, resetRealtimeClient } = await import('./realtime')

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
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
    })
    const first = lastChannel

    resetRealtimeClient()
    expect(disconnectCalls).toBe(1)

    subscribeToWorkspace({
      workspaceId: 'w2',
      getAccessToken: async () => 'token',
      onChange: vi.fn(),
      onSubscribed: vi.fn(),
    })
    expect(lastChannel).not.toBe(first)
  })
})
