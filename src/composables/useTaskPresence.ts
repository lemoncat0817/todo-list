import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { isSyncConfigured } from '@/sync/config'
import type { TaskPresenceEntry, TaskPresenceSubscription } from '@/sync/realtime'

/**
 * 任務層級的線上狀態＋「正在編輯哪個欄位」提示（補做計畫書第 08 節）。
 * 跟 stores/workspace.ts 的工作區線上狀態是同一個 Realtime presence
 * 機制、不同頻道（sync/realtime.ts 的 subscribeToTaskPresence）——這裡
 * 只負責「掛在目前開著的這個任務」這個生命週期，不重新定義 presence
 * 本身怎麼運作。
 *
 * 動態載入 sync/realtime.ts：跟 stores/sync.ts 一樣，沒有同步就不該
 * 載入 @supabase/realtime-js，純本機使用者不用付這個 bundle 成本。
 */
export interface TaskPresence {
  /** 目前這個任務除了自己以外的檢視者。 */
  viewers: Ref<TaskPresenceEntry[]>
  /** 檢視者裡有誰正聚焦在這個欄位——TaskDetailForm.vue 用來畫柔和邊框。 */
  isFieldFocusedByOther: (field: string) => boolean
  /** 目前這個表單自己聚焦到了哪個欄位；傳 null 代表離開所有欄位。 */
  reportFocus: (field: string | null) => void
}

export function useTaskPresence(taskId: Ref<string | null>): TaskPresence {
  const auth = useAuthStore()
  const viewers = ref<TaskPresenceEntry[]>([])

  let subscription: TaskPresenceSubscription | null = null
  let currentTaskId: string | null = null

  function stop(): void {
    subscription?.stop()
    subscription = null
    currentTaskId = null
    viewers.value = []
  }

  async function start(id: string): Promise<void> {
    const userId = auth.session?.user.id
    if (!isSyncConfigured || auth.status !== 'signed-in' || !userId) return
    currentTaskId = id
    // 這是輔助性的提示（誰在看、誰在編輯哪個欄位），不是任務資料本身
    // ——連不上、環境沒設定 Realtime 之類的失敗，不該讓整個任務詳情
    // 表單跟著掛掉，安靜略過即可，跟 stores/sync.ts 的 reportDeviceCursor()
    // 是同一種「best-effort，失敗只印主控台」判斷。
    try {
      const { subscribeToTaskPresence } = await import('@/sync/realtime')
      // 這段 await 期間任務可能已經被切換或關掉了——不检查的話，切換
      // 得夠快時，這裡建立的頻道會晚一步蓋掉正確的訂閱狀態。
      if (currentTaskId !== id) return
      subscription = subscribeToTaskPresence({
        taskId: id,
        userId,
        getAccessToken: async () => auth.session?.access_token ?? null,
        onChange: (next) => {
          viewers.value = [...next]
        },
      })
    } catch (error) {
      console.error('[presence] 建立任務層級的線上狀態訂閱失敗', error)
    }
  }

  watch(
    taskId,
    (id) => {
      stop()
      if (id) void start(id)
    },
    { immediate: true },
  )

  onBeforeUnmount(stop)

  function isFieldFocusedByOther(field: string): boolean {
    return viewers.value.some((v) => v.focusedField === field)
  }

  function reportFocus(field: string | null): void {
    subscription?.updateFocus(field)
  }

  return { viewers, isFieldFocusedByOther, reportFocus }
}
