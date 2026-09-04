<template>
  <section v-if="list.length > 0" class="flex flex-col gap-1.5 rounded-lg border border-line p-3">
    <h3 class="px-1 text-sm font-medium text-ink-soft">活動記錄</h3>
    <ul class="flex flex-col gap-1">
      <li v-for="entry in list" :key="entry.id" class="text-sm text-ink-soft">
        <span class="font-medium text-ink">{{ memberName(entry.actorId) }}</span>
        {{ describe(entry) }}
        <span class="text-xs text-ink-faint">· {{ formatTimestamp(entry.createdAt) }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useActivityStore } from '@/stores/activity'
import { useCollectionsStore } from '@/stores/collections'
import { useMemberName } from '@/composables/useMemberName'
import type { StoredActivity } from '@/db/schema'

/**
 * 任務活動記錄——只讀，完全由伺服器端的 trigger 產生（見
 * supabase/migrations/0013_activity_log.sql），這裡沒有任何寫入互動。
 * 沒有活動記錄時整段不顯示，不留一個空標題。
 */
const props = defineProps<{ taskId: string }>()

const activity = useActivityStore()
const collections = useCollectionsStore()
const memberName = useMemberName()

const list = computed(() => activity.forTask(props.taskId))

/**
 * 換專案的事件要顯示專案名稱——用未過濾的 projects：換到的專案不一定
 * 在目前所在的工作區。收件匣本身就是一筆真的專案（名稱是「收件匣」），
 * 這裡不需要另外特判——它跟其他專案一樣直接查得到名稱。
 */
function projectName(id: unknown): string {
  if (typeof id !== 'string') return '不明的專案'
  return collections.projects.find((p) => p.id === id)?.name ?? '已刪除的專案'
}

function describeDueChange(to: unknown): string {
  if (to === null || to === undefined || to === '') return '清除了截止日期'
  if (typeof to === 'string') return `把截止日期改為 ${to}`
  return '更改了截止日期'
}

function describe(entry: StoredActivity): string {
  switch (entry.kind) {
    case 'created':
      return '建立了這個任務'
    case 'completed':
      return '完成了這個任務'
    case 'reopened':
      return '重新開啟了這個任務'
    case 'moved':
      return `把任務移到「${projectName(entry.detail.to)}」`
    case 'renamed':
      return typeof entry.detail.to === 'string' && entry.detail.to !== ''
        ? `把名稱改為「${entry.detail.to}」`
        : '更改了任務名稱'
    case 'due_changed':
      return describeDueChange(entry.detail.to)
    default:
      return '更新了這個任務'
  }
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
