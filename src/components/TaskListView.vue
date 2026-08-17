<template>
  <div class="flex min-h-0 grow flex-col">
    <!-- 語意上是導覽，視覺上是分段控制項 -->
    <nav aria-label="篩選" class="shrink-0 px-4 pt-3 sm:px-6">
      <div class="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
        <RouterLink v-for="tab in FILTERS" :key="tab.filter" :to="tab.path"
          :aria-current="tab.filter === props.filter ? 'page' : undefined"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="tab.filter === props.filter
            ? 'bg-surface text-ink shadow-xs'
            : 'text-ink-soft hover:text-ink'">
          {{ tab.label }}
          <span class="ml-1 text-xs tabular-nums text-ink-faint">{{ tasks.counts[tab.filter] }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="min-h-0 grow overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
      <p v-if="tasks.isLoading" role="status" aria-live="polite"
        class="py-10 text-center text-sm text-ink-faint">
        載入中…
      </p>

      <p v-else-if="tasks.loadError" role="alert"
        class="rounded-lg border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger-ink">
        無法載入資料，請重新整理再試一次。
      </p>

      <template v-else>
        <!-- 寫入失敗時清單仍可用，用橫幅提示而非取代清單 -->
        <p v-if="tasks.writeError" role="alert"
          class="mb-3 rounded-lg border border-warning-soft bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          變更尚未存檔，請確認瀏覽器儲存空間是否已滿。
        </p>

        <div v-if="list.length === 0" class="py-12 text-center">
          <p class="text-sm text-ink-faint">{{ emptyMessage }}</p>
        </div>

        <ul v-else class="flex flex-col gap-1.5">
          <TaskItem v-for="(item, index) in list" :key="item.id" :task="item"
            :editing="editingId === item.id" :dragging="draggingId === item.id"
            :is-first="index === 0" :is-last="index === list.length - 1"
            @toggle="tasks.toggle(item.id)" @remove="remove(item.id)"
            @start-edit="editingId = item.id" @cancel-edit="editingId = null"
            @save="(name) => save(item.id, name)" @open-detail="detailTask = item"
            @move-up="move(index, -1)" @move-down="move(index, 1)"
            @dragstart="draggingId = item.id" @drop="drop(item.id)" @dragend="draggingId = null" />
        </ul>
      </template>
    </div>

    <TaskDetailDialog :task="detailTask" @close="detailTask = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import TaskItem from './TaskItem.vue'
import TaskDetailDialog from './TaskDetailDialog.vue'
import { FILTERS } from '@/router'
import type { TaskFilter } from '@/domain/filtering'
import type { StoredTask } from '@/db/schema'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'

/**
 * 任務清單。
 *
 * 這個元件只負責「呈現與互動編排」：篩選規則在 domain/filtering，
 * 狀態變更在 stores/tasks，單列的樣子在 TaskItem。
 * 先前它一個人做完這些事，有 250 行。
 */
const props = withDefaults(defineProps<{ filter?: TaskFilter }>(), { filter: 'all' })

const tasks = useTasksStore()
const ui = useUiStore()

// 編輯狀態是 UI 暫態，留在元件裡而非 store——
// 它不需要被持久化，也不需要跨元件共享（稽核 P1 的根因）。
const editingId = ref<string | null>(null)
const draggingId = ref<string | null>(null)
const detailTask = ref<StoredTask | null>(null)

const list = computed(() => tasks.visible(props.filter))

const emptyMessage = computed(() => {
  if (ui.keyword !== '') return `找不到符合「${ui.keyword}」的代辦事項`
  switch (props.filter) {
    case 'active':
      return '沒有未完成的代辦事項'
    case 'completed':
      return '還沒有已完成的代辦事項'
    default:
      return '目前沒有代辦事項，從上方新增一筆吧'
  }
})

function save(id: string, name: string): void {
  tasks.update(id, { taskName: name })
  editingId.value = null
}

function remove(id: string): void {
  // 刪掉的正好是編輯中的那筆時一併結束編輯，
  // 否則殘留的 editingId 會讓那一列的編輯框永遠開著
  if (editingId.value === id) editingId.value = null
  tasks.remove(id)
}

function move(index: number, delta: -1 | 1): void {
  const current = list.value[index]
  const neighbour = list.value[index + delta]
  if (current && neighbour) {
    tasks.move(current.id, neighbour.id, delta === -1 ? 'before' : 'after')
  }
}

function drop(targetId: string): void {
  if (draggingId.value && draggingId.value !== targetId) {
    tasks.move(draggingId.value, targetId, 'before')
  }
  draggingId.value = null
}
</script>
