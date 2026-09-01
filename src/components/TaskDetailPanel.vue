<template>
  <aside aria-label="任務詳情" class="flex shrink-0 flex-col border-l border-line bg-surface"
    :class="collapsed ? 'w-10' : 'w-80 xl:w-96'">
    <div class="flex items-center gap-2 border-b border-line px-4 py-3"
      :class="collapsed ? 'justify-center px-0' : 'justify-between'">
      <h2 v-if="!collapsed" class="truncate text-sm font-semibold tracking-tight text-ink">
        任務詳情
      </h2>

      <!-- 收合只在「沒有任務被選」時有意義：一旦選了任務就無條件展開，
           所以收合鈕跟原本的關閉鈕互斥，不會同時出現。 -->
      <button v-if="!task" type="button" :aria-label="collapsed ? '展開任務詳情' : '收合任務詳情'"
        :data-tooltip="collapsed ? '展開' : '收合'"
        class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        @click="ui.toggleDetailCollapsed()">
        <!--
          跟左側導覽互為鏡像：展開時箭頭朝右（收合會把它推向右邊界），
          收合時箭頭朝左（展開會把內容從右邊界拉回來）。
        -->
        <svg viewBox="0 0 16 16" class="size-3.5 transition-transform" :class="{ 'rotate-180': !collapsed }"
          aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
          stroke-linejoin="round">
          <path d="m9.5 3.5-5 4.5 5 4.5" />
        </svg>
      </button>
      <button v-else type="button" aria-label="關閉任務詳情" data-tooltip="關閉"
        class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        @click="emit('close')">
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>

    <div v-if="!collapsed" class="min-h-0 grow overflow-y-auto px-4 py-4">
      <p v-if="!task" class="text-sm text-ink-faint">
        選一筆代辦事項，這裡會顯示它的細節。
      </p>
      <TaskDetailForm v-else :task="task" @close="emit('close')" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TaskDetailForm from './TaskDetailForm.vue'
import type { StoredTask } from '@/db/schema'
import { useUiStore } from '@/stores/ui'

/**
 * 寬螢幕的常駐詳情欄。
 *
 * 空狀態不會自動隱藏整個面板，而是留著並說明用途：面板忽隱忽現會讓中間的
 * 清單每次選取都跟著改變寬度，讀到一半的行會整排跳掉——這個結論不變。
 *
 * 但「使用者自己按按鈕收合」是另一回事：那是有意識的動作，不會有前述的
 * 意外跳動問題，所以收合鈕本身是安全的。收合只是暫時迴避——只要選了
 * 任何一筆任務，面板就無條件展開回來（見下面 collapsed 的判斷式），
 * 不會出現「收合了結果打不開任務」的死角。
 */
const props = defineProps<{ task: StoredTask | null }>()
const emit = defineEmits<{ close: [] }>()

const ui = useUiStore()
const collapsed = computed(() => ui.isDetailCollapsed && props.task === null)
</script>
