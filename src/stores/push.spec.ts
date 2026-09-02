import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Session } from '@supabase/auth-js'

const pushClientMocks = vi.hoisted(() => ({
  getExistingSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}))
vi.mock('@/sync/pushClient', () => pushClientMocks)

const { usePushStore } = await import('@/stores/push')
const { useAuthStore } = await import('@/stores/auth')

function fakeSession(): Session {
  return {
    access_token: 'token-123',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1' },
  } as unknown as Session
}

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { push: usePushStore(), auth: useAuthStore() }
}

/** 這幾支測試要驗證「支援時」的行為，happy-dom 預設不提供這些 API（跟 window.confirm 同一種情況）。 */
function stubSupported() {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', { value: {}, configurable: true })
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true })
  Object.defineProperty(globalThis, 'Notification', {
    value: Object.assign(vi.fn(), { permission: 'default', requestPermission: vi.fn() }),
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator, 'serviceWorker')
  Reflect.deleteProperty(globalThis, 'PushManager')
  Reflect.deleteProperty(globalThis, 'Notification')
})

describe('push store — supported', () => {
  it('瀏覽器缺少必要的 API 時 supported 是 false', () => {
    const { push } = setup()
    expect(push.supported).toBe(false)
  })

  it('三個 API 都有時 supported 是 true', () => {
    stubSupported()
    const { push } = setup()
    expect(push.supported).toBe(true)
  })
})

describe('push store — enable', () => {
  it('權限預設（default）時先請求權限，取得同意後才真的訂閱', async () => {
    stubSupported()
    vi.mocked(Notification.requestPermission).mockResolvedValue('granted')
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.enable()

    expect(Notification.requestPermission).toHaveBeenCalled()
    expect(pushClientMocks.subscribeToPush).toHaveBeenCalledWith('token-123')
    expect(push.subscribed).toBe(true)
    expect(push.error).toBeNull()
  })

  it('使用者拒絕權限時不訂閱，顯示對應的說法', async () => {
    stubSupported()
    vi.mocked(Notification.requestPermission).mockResolvedValue('denied')
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.enable()

    expect(pushClientMocks.subscribeToPush).not.toHaveBeenCalled()
    expect(push.subscribed).toBe(false)
    expect(push.error).toBe('沒有取得瀏覽器的通知權限，無法開啟推播')
  })

  it('權限已經被瀏覽器封鎖（denied）時不會再跳權限請求，直接顯示說法', async () => {
    stubSupported()
    Object.defineProperty(Notification, 'permission', { value: 'denied', configurable: true })
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.enable()

    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(pushClientMocks.subscribeToPush).not.toHaveBeenCalled()
    expect(push.error).toBe('瀏覽器已封鎖通知權限，請到瀏覽器的網站設定重新允許')
  })

  it('已經有權限（granted）時不重新請求，直接訂閱', async () => {
    stubSupported()
    Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true })
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.enable()

    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(pushClientMocks.subscribeToPush).toHaveBeenCalledWith('token-123')
    expect(push.subscribed).toBe(true)
  })

  it('訂閱失敗時顯示友善說法，不點名技術細節', async () => {
    stubSupported()
    Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true })
    pushClientMocks.subscribeToPush.mockRejectedValue(new Error('HTTP 500: something broke'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.enable()

    expect(push.subscribed).toBe(false)
    expect(push.error).toBe('開啟推播通知失敗，請稍後再試一次')
    expect(push.error).not.toContain('HTTP 500')
  })

  it('不支援或沒登入時什麼都不做', async () => {
    const { push } = setup()
    await push.enable()
    expect(pushClientMocks.subscribeToPush).not.toHaveBeenCalled()
  })
})

describe('push store — disable', () => {
  it('呼叫 unsubscribeFromPush 並把 subscribed 設回 false', async () => {
    stubSupported()
    const { push, auth } = setup()
    auth.session = fakeSession()
    push.subscribed = true

    await push.disable()

    expect(pushClientMocks.unsubscribeFromPush).toHaveBeenCalledWith('token-123')
    expect(push.subscribed).toBe(false)
  })

  it('失敗時顯示友善說法', async () => {
    stubSupported()
    pushClientMocks.unsubscribeFromPush.mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { push, auth } = setup()
    auth.session = fakeSession()

    await push.disable()

    expect(push.error).toBe('關閉推播通知失敗，請稍後再試一次')
  })
})

describe('push store — refresh', () => {
  it('用 getExistingSubscription() 的結果同步 subscribed 狀態', async () => {
    stubSupported()
    pushClientMocks.getExistingSubscription.mockResolvedValue({ endpoint: 'x' })
    const { push } = setup()

    await push.refresh()

    expect(push.subscribed).toBe(true)
  })
})
