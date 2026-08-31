import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { usePrefsStore } from '@/stores/prefs'
import { today } from '@/domain/dates'

/**
 * 到期提醒。
 *
 * 誠實的限制：沒有伺服器就沒有 Web Push，所以這只在分頁還開著的時候有效。
 * 分頁關掉、瀏覽器關掉，就不會有提醒。這一點必須在畫面上講清楚，
 * 不能讓使用者以為自己有一個會準時響的鬧鐘——那比完全沒有提醒更糟。
 *
 * 每分鐘檢查一次而不是為每一筆任務排一個 timer：任務可以被改期、刪除、完成，
 * 一堆需要同步取消的 timer 是 bug 的溫床，而每分鐘掃一次幾百筆的成本可以忽略。
 */

const CHECK_INTERVAL_MS = 60_000

export interface DueReminders {
  /** 目前的授權狀態，畫面用它決定要顯示「開啟」還是「已被瀏覽器封鎖」。 */
  permission: () => NotificationPermission | 'unsupported'
  /** 請求授權並開啟；回傳最終是否成功開啟。 */
  enable: () => Promise<boolean>
  disable: () => void
}

function permissionOf(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export function useDueReminders(): DueReminders {
  const tasks = useTasksStore()
  const prefs = usePrefsStore()

  /** 已經提醒過的任務，避免同一筆每分鐘響一次。只存在於這個工作階段。 */
  const notified = new Set<string>()
  let timer: ReturnType<typeof setInterval> | null = null

  function nowHHmm(date = new Date()): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  function check(): void {
    if (!prefs.remindersEnabled || permissionOf() !== 'granted') return

    const todayISO = today()
    const currentTime = nowHHmm()

    for (const task of tasks.items) {
      if (task.isCompleted || notified.has(task.id)) continue
      if (task.dueDate !== todayISO || task.dueTime === null) continue
      // 只提醒已經到點的：還沒到的留到下一輪
      if (task.dueTime > currentTime) continue

      notified.add(task.id)
      new Notification('代辦事項到期', {
        body: `${task.taskName}（${task.dueTime}）`,
        tag: task.id,
      })
    }
  }

  function start(): void {
    if (timer !== null) return
    check()
    timer = setInterval(check, CHECK_INTERVAL_MS)
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  watch(
    () => prefs.remindersEnabled,
    (enabled) => (enabled ? start() : stop()),
  )

  onMounted(() => {
    if (prefs.remindersEnabled) start()
  })
  onBeforeUnmount(stop)

  async function enable(): Promise<boolean> {
    if (permissionOf() === 'unsupported') return false
    const result =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
    // 被拒絕時不要把開關留在「開」的狀態：那會顯示成「已開啟」但永遠不會響
    prefs.setReminders(result === 'granted')
    return result === 'granted'
  }

  function disable(): void {
    prefs.setReminders(false)
  }

  return { permission: permissionOf, enable, disable }
}
