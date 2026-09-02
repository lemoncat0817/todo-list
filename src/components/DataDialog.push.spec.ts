import { describe, it, expect, vi, afterEach } from 'vitest'
import DataDialog from '@/components/DataDialog.vue'
import { usePushStore } from '@/stores/push'
import { useAuthStore } from '@/stores/auth'
import { freshPinia, mountWith } from '@/test/helpers'

vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isPushConfigured: true,
}))

/** push.supported 讀的三個瀏覽器 API，happy-dom 不提供，跟 push.spec.ts 同一個坑。 */
function stubPushSupported() {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', { value: {}, configurable: true })
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true })
  Object.defineProperty(globalThis, 'Notification', {
    value: Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn() }),
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator, 'serviceWorker')
  Reflect.deleteProperty(globalThis, 'PushManager')
  Reflect.deleteProperty(globalThis, 'Notification')
  vi.restoreAllMocks()
})

describe('DataDialog.vue — 推播通知區塊（isPushConfigured 為 true）', () => {
  it('尚未登入時顯示「登入後才能開啟」，不顯示開關', () => {
    const pinia = freshPinia()
    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('推播通知')
    expect(w.text()).toContain('登入後才能開啟')
    // 沒 stub 瀏覽器通知 API，到期提醒那段也判定成不支援，所以這裡預期 0 顆——
    // 只是確認推播區塊本身沒有洩漏出開關，不是在驗到期提醒的行為。
    expect(w.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('已登入時顯示開關；勾選會呼叫 push.enable()', async () => {
    stubPushSupported()
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    const push = usePushStore()
    const enableSpy = vi.spyOn(push, 'enable').mockResolvedValue()

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    const checkboxes = w.findAll('input[type="checkbox"]')
    // 第一個是到期提醒的開關，第二個才是推播通知的。
    expect(checkboxes.length).toBe(2)
    await checkboxes[1]?.setValue(true)

    expect(enableSpy).toHaveBeenCalled()
  })

  it('取消勾選會呼叫 push.disable()', async () => {
    stubPushSupported()
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    const push = usePushStore()
    push.subscribed = true
    const disableSpy = vi.spyOn(push, 'disable').mockResolvedValue()

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    const checkboxes = w.findAll('input[type="checkbox"]')
    await checkboxes[1]?.setValue(false)

    expect(disableSpy).toHaveBeenCalled()
  })

  it('顯示 push.error', () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    usePushStore().error = '開啟推播通知失敗，請稍後再試一次'

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('開啟推播通知失敗，請稍後再試一次')
  })
})
