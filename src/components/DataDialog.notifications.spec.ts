import { describe, it, expect, vi } from 'vitest'
import DataDialog from '@/components/DataDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { freshPinia, mountWith } from '@/test/helpers'

// 理由同 DataDialog.push.spec.ts：isSyncConfigured 為 true 的情境需要
// 獨立成一支檔案，vi.mock 實際上整個檔案生效。這裡刻意不動
// isPushConfigured（維持測試環境預設的 false），讓「推播通知」區塊
// 保持不顯示，測試才只聚焦在新增的「通知偏好」區塊上。
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

describe('DataDialog.vue — 通知偏好區塊', () => {
  it('未登入時整段不顯示', () => {
    const pinia = freshPinia()
    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).not.toContain('通知偏好')
  })

  it('已登入時顯示三顆開關，狀態來自 notifications.prefs', () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    const notifications = useNotificationsStore()
    notifications.prefs = { notifyOnMention: false, notifyOnAssignment: true, dailyDigestEnabled: true }

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('通知偏好')
    // 沒 stub Notification API，到期提醒那段判定成不支援、不出現開關，
    // 所以這裡只有三顆，依序是提及／指派／每日摘要。
    const checkboxes = w.findAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(3)
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(false)
    expect((checkboxes[1]!.element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[2]!.element as HTMLInputElement).checked).toBe(true)
  })

  it('切換其中一顆會呼叫 notifications.setPref() 帶上對應欄位', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    const notifications = useNotificationsStore()
    const setPrefSpy = vi.spyOn(notifications, 'setPref').mockResolvedValue()

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    const checkboxes = w.findAll('input[type="checkbox"]')
    await checkboxes[1]?.setValue(false)

    expect(setPrefSpy).toHaveBeenCalledWith({ notifyOnAssignment: false })
  })

  it('顯示 notifications.error', () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    useNotificationsStore().error = '更新通知偏好失敗，請稍後再試一次'

    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).toContain('更新通知偏好失敗，請稍後再試一次')
  })

  it('開啟對話框時呼叫 notifications.refreshPrefs()', async () => {
    const pinia = freshPinia()
    useAuthStore().status = 'signed-in'
    const notifications = useNotificationsStore()
    const refreshSpy = vi.spyOn(notifications, 'refreshPrefs').mockResolvedValue()

    // watch(() => props.open, ...) 不是 immediate，掛載時就給 true 不會觸發；
    // 要模擬「使用者按下去開啟」，得先掛載成關閉，再把 open 真的翻成 true。
    const w = mountWith(DataDialog, pinia, { props: { open: false } })
    await w.setProps({ open: true })

    expect(refreshSpy).toHaveBeenCalled()
  })
})
