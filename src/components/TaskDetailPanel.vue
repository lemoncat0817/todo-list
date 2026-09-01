<template>
  <aside aria-label="任務詳情"
    class="flex w-80 shrink-0 flex-col border-l border-line bg-surface xl:w-96">
    <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
      <h2 class="truncate text-sm font-semibold tracking-tight text-ink">任務詳情</h2>
      <button v-if="task" type="button" aria-label="關閉任務詳情"
        class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        @click="emit('close')">
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>

    <div class="min-h-0 grow overflow-y-auto px-4 py-4">
      <p v-if="!task" class="text-sm text-ink-faint">
        選一筆代辦事項，這裡會顯示它的細節。
      </p>
      <TaskDetailForm v-else :task="task" @close="emit('close')" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import TaskDetailForm from './TaskDetailForm.vue'
import type { StoredTask } from '@/db/schema'

/**
 * 寬螢幕的常駐詳情欄。
 *
 * 空狀態不隱藏整個面板，而是留著並說明用途：面板忽隱忽現會讓中間的清單
 * 每次選取都跟著改變寬度，讀到一半的行會整排跳掉。
 */
defineProps<{ task: StoredTask | null }>()
const emit = defineEmits<{ close: [] }>()
</script>
