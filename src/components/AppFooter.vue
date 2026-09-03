<template>
  <footer class="shrink-0 border-t border-line">
    <!--
      稽核 P15 / P16：破壞性操作不再用阻塞式 confirm 攔一次，
      改為做完之後可復原。提示放在 footer 上方，不遮擋清單。

      同一條列也承接「失敗」：許多 store 以前只 console.error，使用者
      完全看不到。優先順序是 flash（明確的一次性錯誤）→ 本地寫入失敗
      → 可復原操作。同步失敗另外一列，避免網路不穩時把復原提示蓋掉。
    -->
    <p v-if="banner" :role="banner.role" :aria-live="banner.live"
      :data-test="banner.test" :class="banner.classes">
      <span class="min-w-0 grow truncate" :class="banner.textClass">{{ banner.text }}</span>
      <button v-if="banner.undo" type="button" data-test="undo"
        class="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
        @click="history.undo()">
        復原
      </button>
      <button v-if="banner.dismissable" type="button" aria-label="關閉提示"
        class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        @click="banner.dismiss()">
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </p>

    <p v-if="sync.syncError" role="alert" aria-live="assertive" data-test="sync-error"
      class="animate-rise border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger-ink sm:px-6">
      同步失敗：{{ sync.syncError }}
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
import { useFlashStore } from '@/stores/flash'
import { useSyncStore } from '@/stores/sync'

const tasks = useTasksStore()
const history = useHistoryStore()
const workspace = useWorkspaceStore()
const flash = useFlashStore()
const sync = useSyncStore()

const BANNER_BASE = 'animate-rise flex items-center gap-2 border-b border-line px-4 py-2 text-sm sm:px-6'

type Banner = {
  text: string
  role: 'alert' | 'status'
  live: 'assertive' | 'polite'
  test: string
  classes: string
  textClass: string
  undo: boolean
  dismissable: boolean
  dismiss: () => void
}

const banner = computed<Banner | null>(() => {
  if (flash.message) {
    const isError = flash.kind === 'error'
    return {
      text: flash.message,
      role: isError ? 'alert' : 'status',
      live: isError ? 'assertive' : 'polite',
      test: 'flash',
      classes: `${BANNER_BASE} ${isError ? 'bg-danger-soft' : 'bg-sunken'}`,
      textClass: isError ? 'text-danger-ink' : 'text-ink-soft',
      undo: false,
      dismissable: true,
      dismiss: () => flash.dismiss(),
    }
  }
  if (tasks.writeError) {
    return {
      text: '變更尚未存檔，請確認瀏覽器儲存空間是否已滿。',
      role: 'alert',
      live: 'assertive',
      test: 'write-error',
      classes: `${BANNER_BASE} bg-warning-soft`,
      textClass: 'text-warning-ink',
      undo: false,
      dismissable: false,
      dismiss: () => {},
    }
  }
  if (history.lastAction) {
    return {
      text: history.lastAction,
      role: 'status',
      live: 'polite',
      test: 'last-action',
      classes: `${BANNER_BASE} bg-sunken`,
      textClass: 'text-ink-soft',
      undo: history.canUndo && (workspace.canWriteTasks || workspace.canComment),
      dismissable: true,
      dismiss: () => history.dismiss(),
    }
  }
  return null
})

/** 計數走 domain 的同一條篩選路徑，畫面與分頁標籤不會算出不同答案。 */
const counts = computed(() => tasks.counts)
</script>
