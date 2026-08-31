<template>
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

      <div v-if="groups.length === 0" class="py-12 text-center">
        <p class="text-sm text-ink-faint">{{ emptyText }}</p>
      </div>

      <div v-else class="flex flex-col gap-5">
        <section v-for="group in groups" :key="group.key" class="flex flex-col gap-1.5">
          <h2 v-if="group.label" class="text-sm font-semibold tracking-tight"
            :class="group.key === 'overdue' ? 'text-danger-ink' : 'text-ink-soft'">
            {{ group.label }}
          </h2>

          <ul class="flex flex-col gap-1.5">
            <TaskItem v-for="(item, index) in group.tasks" :key="item.id" :task="item"
              :editing="editingId === item.id" :dragging="draggingId === item.id"
              :selected="ui.detailTaskId === item.id"
              :is-first="index === 0" :is-last="index === group.tasks.length - 1"
              @toggle="tasks.toggle(item.id)" @remove="remove(item.id)"
              @start-edit="editingId = item.id" @cancel-edit="editingId = null"
              @save="(name) => save(item.id, name)" @open-detail="ui.openDetail(item.id)"
              @move-up="move(group.tasks, index, -1)" @move-down="move(group.tasks, index, 1)"
              @dragstart="draggingId = item.id" @drop="drop(item.id)" @dragend="draggingId = null" />
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TaskItem from './TaskItem.vue'
import { emptyMessage, type ViewKind, type ViewSpec } from '@/domain/views'
import type { StoredTask } from '@/db/schema'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'

/**
 * 任務清單。
 *
 * 這個元件只負責「呈現與互動編排」：哪些任務屬於這個檢視、怎麼分組，
 * 全在 domain/views；狀態變更在 stores/tasks；單列的樣子在 TaskItem。
 *
 * 分頁列已經移除——檢視的切換是側邊欄的事。清單只需要知道「現在是哪個檢視」，
 * 而那從網址來（由 router 以 props 傳入），不是自己的狀態。
 */
const props = withDefaults(defineProps<{ viewKind?: ViewKind; viewId?: string | null }>(), {
  viewKind: 'all',
  viewId: null,
})

const tasks = useTasksStore()
const ui = useUiStore()

// 編輯狀態是 UI 暫態，留在元件裡而非 store——
// 它不需要被持久化，也不需要跨元件共享（稽核 P1 的根因）。
const editingId = ref<string | null>(null)
const draggingId = ref<string | null>(null)

const spec = computed<ViewSpec>(() => ({ kind: props.viewKind, id: props.viewId }))
const groups = computed(() => tasks.groupsOf(spec.value))
const emptyText = computed(() => emptyMessage(spec.value, ui.keyword))

// 換檢視時結束編輯：留著的話，切回來會看到一列莫名開著輸入框
watch(spec, () => {
  editingId.value = null
})

function save(id: string, name: string): void {
  tasks.update(id, { taskName: name })
  editingId.value = null
}

function remove(id: string): void {
  // 刪掉的正好是編輯中的那筆時一併結束編輯，
  // 否則殘留的 editingId 會讓那一列的編輯框永遠開著
  if (editingId.value === id) editingId.value = null
  if (ui.detailTaskId === id) ui.closeDetail()
  tasks.remove(id)
}

/** 上移／下移只在同一個分組內移動——跨分組的「上一列」在視覺上並不相鄰。 */
function move(list: readonly StoredTask[], index: number, delta: -1 | 1): void {
  const current = list[index]
  const neighbour = list[index + delta]
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
