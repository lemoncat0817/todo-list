<template>
  <footer class="shrink-0 border-t border-line">
    <!--
      稽核 P15 / P16：破壞性操作不再用阻塞式 confirm 攔一次，
      改為做完之後可復原。提示放在 footer 上方，不遮擋清單。
    -->
    <p v-if="history.lastAction" role="status" aria-live="polite"
      class="animate-rise flex items-center gap-2 border-b border-line bg-sunken px-4 py-2 text-sm sm:px-6">
      <span class="min-w-0 grow truncate text-ink-soft">{{ history.lastAction }}</span>
      <button v-if="history.canUndo && (workspace.canWriteTasks || workspace.canComment)" type="button" data-test="undo"
        class="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
        @click="history.undo()">
        復原
      </button>
      <button type="button" aria-label="關閉提示"
        class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        @click="history.dismiss()">
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </p>

    <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
      <p class="text-sm tabular-nums text-ink-faint">
        全部: {{ counts.all }} 項
        <span aria-hidden="true" class="mx-1.5 text-line-strong">·</span>
        未完成: {{ counts.active }} 項
        <span aria-hidden="true" class="mx-1.5 text-line-strong">·</span>
        已完成: {{ counts.completed }} 項
      </p>

      <button type="button"
        class="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-danger-soft hover:text-danger-ink disabled:pointer-events-none disabled:opacity-40"
        data-test="clear-completed" :disabled="counts.completed === 0 || !workspace.canWriteTasks"
        @click="tasks.clearCompleted()">
        清除已完成代辦事項
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useHistoryStore } from '@/stores/history'
import { useWorkspaceStore } from '@/stores/workspace'

const tasks = useTasksStore()
const history = useHistoryStore()
const workspace = useWorkspaceStore()

/** 計數走 domain 的同一條篩選路徑，畫面與分頁標籤不會算出不同答案。 */
const counts = computed(() => tasks.counts)
</script>
