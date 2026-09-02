import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./config', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon-key',
  VAPID_PUBLIC_KEY: 'BLtest-vapid-public-key-AAAA',
}))

/**
 * happy-dom 不提供 serviceWorker／PushManager／Notification（跟
 * window.alert／confirm 是同一種情況，見 test/helpers.ts 的
 * stubDialogs 說明），這裡自己搭一組最小可用的假實作。
 */
function makeFakeSubscription(endpoint = 'https://push.example/ep1') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

function stubServiceWorker(subscription: ReturnType<typeof makeFakeSubscription> | null) {
  const subscribe = vi.fn().mockResolvedValue(subscription ?? makeFakeSubscription())
  const getSubscription = vi.fn().mockResolvedValue(subscription)
  const registration = { pushManager: { subscribe, getSubscription } }
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true })
  return { subscribe, getSubscription }
}

const { getExistingSubscription, subscribeToPush, unsubscribeFromPush } = await import('./pushClient')

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis.navigator, 'serviceWorker')
  Reflect.deleteProperty(globalThis, 'PushManager')
})

describe('getExistingSubscription', () => {
  it('瀏覽器不支援時回傳 null，不丟例外', async () => {
    await expect(getExistingSubscription()).resolves.toBeNull()
  })

  it('回傳 PushManager.getSubscription() 的結果', async () => {
    const sub = makeFakeSubscription()
    stubServiceWorker(sub)
    await expect(getExistingSubscription()).resolves.toBe(sub)
  })
})

describe('subscribeToPush', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('用 VAPID 公鑰跟瀏覽器要一組訂閱，再把 endpoint／金鑰存進 Supabase', async () => {
    const sub = makeFakeSubscription()
    const { subscribe } = stubServiceWorker(sub)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)

    await subscribeToPush('token-123')

    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    )
    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/rest/v1/push_subscriptions?on_conflict=user_id,endpoint')
    expect((options as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((options as RequestInit).body))).toEqual([
      { endpoint: sub.endpoint, p256dh: 'p256dh-value', auth: 'auth-value' },
    ])
  })

  it('存進 Supabase 失敗時取消瀏覽器端的訂閱，不留下半吊子狀態', async () => {
    const sub = makeFakeSubscription()
    stubServiceWorker(sub)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => 'boom' } as Response)

    await expect(subscribeToPush('token-123')).rejects.toThrow()
    expect(sub.unsubscribe).toHaveBeenCalled()
  })
})

describe('unsubscribeFromPush', () => {
  it('沒有既有訂閱時什麼都不做', async () => {
    stubServiceWorker(null)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await unsubscribeFromPush('token-123')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('取消瀏覽器端訂閱，並從 Supabase 刪除對應的 endpoint', async () => {
    const sub = makeFakeSubscription('https://push.example/to-remove')
    stubServiceWorker(sub)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => '' } as Response)

    await unsubscribeFromPush('token-123')

    expect(sub.unsubscribe).toHaveBeenCalled()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain(encodeURIComponent('https://push.example/to-remove'))
    expect((options as RequestInit).method).toBe('DELETE')
  })
})
