<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,28rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-3 p-5">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold tracking-tight">通知</h2>
        <button v-if="notifications.unreadCount > 0" type="button"
          class="rounded-md px-2 py-1 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-soft"
          @click="notifications.markAllRead()">
          全部標為已讀
        </button>
      </div>

      <p v-if="notifications.error" role="alert" class="text-sm text-danger-ink">{{ notifications.error }}</p>

      <p v-if="notifications.sorted.length === 0" class="text-sm text-ink-faint">還沒有通知</p>

      <ul v-else class="flex flex-col gap-1">
        <li v-for="n in notifications.sorted" :key="n.id">
          <button type="button"
            class="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sunken"
            :class="n.readAt === null ? 'bg-accent-soft/40' : ''" @click="notifications.markRead(n.id)">
            <span class="flex items-center gap-1.5 text-[15px] text-ink">
              <span v-if="n.readAt === null" class="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span class="font-medium">{{ memberName(n.actorId) }}</span>
              {{ n.kind === 'mention' ? '在留言裡提到你' : '把任務指派給你' }}
            </span>
            <span class="truncate text-sm text-ink-soft">{{ taskName(n.taskId) }}</span>
            <span class="text-xs text-ink-faint">{{ formatTimestamp(n.createdAt) }}</span>
          </button>
        </li>
      </ul>

      <div class="flex justify-end border-t border-line pt-3">
        <button type="button"
          class="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('close')">
          關閉
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useNotificationsStore } from '@/stores/notifications'
import { useTasksStore } from '@/stores/tasks'
import { useMemberName } from '@/composables/useMemberName'

/**
 * 通知中心。跟其餘對話框（DataDialog／MembersDialog……）同一個 <dialog>
 * 慣例，不是自己刻一個下拉選單——原生 <dialog> 的焦點鎖定／Esc 關閉／
 * 背景 inert 都是平台提供的，自己刻一個 popover 得重新處理這三件事，
 * 而且很容易漏掉焦點鎖定（稽核 P15 記錄過同一類問題）。
 *
 * 點一則通知只會標成已讀，不會導去那筆任務——這個 app 目前沒有任務
 * 詳情的深連結路由（跟 public/sw.js 的 notificationclick 是同一個
 * 誠實的範圍限制，不假裝支援），要看完整內容仍然要自己去對應的專案找。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const notifications = useNotificationsStore()
const tasks = useTasksStore()
const memberName = useMemberName()

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  },
)

function taskName(taskId: string): string {
  return tasks.items.find((t) => t.id === taskId)?.taskName ?? '（已刪除的任務）'
}

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat('zh-Hant', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}
</script>
