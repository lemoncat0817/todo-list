import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { freshPinia } from '@/test/helpers'
import { useTasksStore } from '@/stores/tasks'
import { usePrefsStore } from '@/stores/prefs'
import { today } from '@/domain/dates'
import { useDueReminders } from './useDueReminders'

describe('useDueReminders', () => {
  const originalNotification = globalThis.Notification
  let mockNotificationClass: any
  let notificationsSent: { title: string; options: any }[] = []

  beforeEach(() => {
    freshPinia()
    notificationsSent = []

    mockNotificationClass = vi.fn(function (title: string, options: any) {
      notificationsSent.push({ title, options })
    }) as any
    mockNotificationClass.permission = 'granted'
    mockNotificationClass.requestPermission = vi.fn().mockResolvedValue('granted')
    globalThis.Notification = mockNotificationClass
  })

  afterEach(() => {
    globalThis.Notification = originalNotification
    vi.useRealTimers()
  })

  function mountTestComponent() {
    let result!: ReturnType<typeof useDueReminders>
    const Comp = defineComponent({
      setup() {
        result = useDueReminders()
        return () => h('div')
      },
    })
    const wrapper = mount(Comp)
    return { wrapper, reminders: result }
  }

  it('環境不支援 Notification 時回傳 unsupported 且 enable 回傳 false', async () => {
    // @ts-expect-error test undefined
    delete globalThis.Notification

    const { reminders } = mountTestComponent()
    expect(reminders.permission()).toBe('unsupported')

    const success = await reminders.enable()
    expect(success).toBe(false)
    expect(usePrefsStore().remindersEnabled).toBe(false)
  })

  it('enable 在已授權時直接開啟提醒並回傳 true', async () => {
    mockNotificationClass.permission = 'granted'
    const { reminders } = mountTestComponent()

    const success = await reminders.enable()
    expect(success).toBe(true)
    expect(usePrefsStore().remindersEnabled).toBe(true)
    expect(mockNotificationClass.requestPermission).not.toHaveBeenCalled()
  })

  it('enable 在未授權時主動呼叫 requestPermission，被拒絕時回傳 false 並關閉偏好', async () => {
    mockNotificationClass.permission = 'default'
    mockNotificationClass.requestPermission.mockResolvedValueOnce('denied')
    const { reminders } = mountTestComponent()

    const success = await reminders.enable()
    expect(success).toBe(false)
    expect(mockNotificationClass.requestPermission).toHaveBeenCalled()
    expect(usePrefsStore().remindersEnabled).toBe(false)
  })

  it('disable 會將偏好設定中的提醒關閉', () => {
    const prefs = usePrefsStore()
    prefs.setReminders(true)
    const { reminders } = mountTestComponent()

    reminders.disable()
    expect(prefs.remindersEnabled).toBe(false)
  })

  it('提醒開啟時，檢查並發送符合今天且已到時間的任務通知', () => {
    const prefs = usePrefsStore()
    prefs.setReminders(true)

    const tasks = useTasksStore()
    const todayISO = today()

    // 建立 4 筆任務：
    // 1. 符合條件（今天、時間 00:01 已過）
    // 2. 已完成（應略過）
    // 3. 非今天（應略過）
    // 4. 未來時間（應略過，23:59）
    const t1 = tasks.add('該做的事 1')
    tasks.update(t1.id, { dueDate: todayISO, dueTime: '00:01' })

    const t2 = tasks.add('已完成的事')
    tasks.update(t2.id, { dueDate: todayISO, dueTime: '00:01' })
    tasks.toggle(t2.id)

    const t3 = tasks.add('明天的任務')
    tasks.update(t3.id, { dueDate: '2099-01-01', dueTime: '00:01' })

    const t4 = tasks.add('未來的任務')
    tasks.update(t4.id, { dueDate: todayISO, dueTime: '23:59' })

    mountTestComponent()

    expect(notificationsSent.length).toBe(1)
    expect(notificationsSent[0]?.title).toBe('代辦事項到期')
    expect(notificationsSent[0]?.options.tag).toBe(t1.id)
    expect(notificationsSent[0]?.options.body).toContain('該做的事 1')
  })

  it('同一個已通知過的任務不會重複發送通知', () => {
    vi.useFakeTimers()
    const prefs = usePrefsStore()
    prefs.setReminders(true)

    const tasks = useTasksStore()
    const t1 = tasks.add('特定事項')
    tasks.update(t1.id, { dueDate: today(), dueTime: '00:01' })

    mountTestComponent()
    expect(notificationsSent.length).toBe(1)

    // 前進一分鐘再次觸發輪詢
    vi.advanceTimersByTime(60_000)
    expect(notificationsSent.length).toBe(1)
  })

  it('組件卸載時會清除輪詢定時器', () => {
    vi.useFakeTimers()
    const prefs = usePrefsStore()
    prefs.setReminders(true)

    const tasks = useTasksStore()
    const t1 = tasks.add('第一件事')
    tasks.update(t1.id, { dueDate: today(), dueTime: '00:01' })

    const { wrapper } = mountTestComponent()
    expect(notificationsSent.length).toBe(1)

    wrapper.unmount()

    // 新增另一筆過期任務
    const t2 = tasks.add('第二件事')
    tasks.update(t2.id, { dueDate: today(), dueTime: '00:01' })

    vi.advanceTimersByTime(60_000)
    // 因已卸載，不應再檢查觸發新通知
    expect(notificationsSent.length).toBe(1)
  })
})
