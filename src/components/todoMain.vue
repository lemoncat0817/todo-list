<template>
  <div class="flex min-h-0 grow flex-col">
    <!-- 分頁：語意上是導覽，視覺上是分段控制項 -->
    <nav aria-label="篩選" class="shrink-0 px-4 pt-3 sm:px-6">
      <div class="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
        <RouterLink v-for="tab in FILTERS" :key="tab.filter" :to="tab.path"
          :aria-current="tab.filter === props.filter ? 'page' : undefined"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="tab.filter === props.filter
            ? 'bg-surface text-ink shadow-xs'
            : 'text-ink-soft hover:text-ink'">
          {{ tab.label }}
          <span class="ml-1 text-xs tabular-nums text-ink-faint">{{ countOf(tab.filter) }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="min-h-0 grow overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
      <p v-if="store.isLoading" role="status" aria-live="polite"
        class="py-10 text-center text-sm text-ink-faint">
        載入中…
      </p>

      <p v-else-if="store.loadError" role="alert"
        class="rounded-lg border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger-ink">
        無法載入資料，請重新整理再試一次。
      </p>

      <template v-else>
        <!-- 寫入失敗時清單仍可用，用橫幅提示而非取代清單 -->
        <p v-if="store.writeError" role="alert"
          class="mb-3 rounded-lg border border-warning-soft bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          變更尚未存檔，請確認瀏覽器儲存空間是否已滿。
        </p>

        <div v-if="taskList.length === 0" class="py-12 text-center">
          <p class="text-sm text-ink-faint">{{ emptyMessage }}</p>
        </div>

        <ul v-else class="flex flex-col gap-1.5">
          <!-- 拖曳是指標裝置的增強，不是唯一路徑：每列都有上移／下移按鈕，
               鍵盤與螢幕閱讀器使用者走那條路。這正是該規則要保護的東西。 -->
          <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
          <li v-for="(item, index) in taskList" :key="item.id" draggable="true"
            class="group animate-rise rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong"
            :class="draggingId === item.id ? 'opacity-50' : ''" @dragstart="draggingId = item.id"
            @dragover.prevent @drop="onDrop(item.id)" @dragend="draggingId = null">
            <div class="flex items-start gap-3">
              <input :checked="item.isCompleted" type="checkbox"
                :aria-label="`標記「${item.taskName}」為已完成`"
                class="mt-0.5 size-4.5 shrink-0 cursor-pointer accent-accent"
                @change="store.toggleCompleted(item.id)">

              <div class="min-w-0 grow">
                <p v-if="editingId !== item.id" class="break-words text-[15px] leading-snug"
                  :class="item.isCompleted ? 'text-ink-faint line-through' : 'text-ink'">
                  {{ item.taskName }}
                </p>
                <input v-else v-model="editTaskName" :aria-label="`編輯「${item.taskName}」`"
                  placeholder="輸入內容"
                  class="w-full rounded-md border border-accent bg-surface px-2 py-1 text-[15px] text-ink focus:outline-none"
                  @keyup.enter="saveTask(item)" @keyup.esc="cancelEdit">

                <p v-if="item.notes" class="mt-1 line-clamp-2 text-[13px] text-ink-faint">
                  {{ item.notes }}
                </p>

                <p v-if="hasMeta(item)" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span v-if="item.priority > 0"
                    :aria-label="`優先度：${PRIORITY_LABELS[item.priority]}`"
                    class="inline-flex items-center gap-1 text-[12px] font-medium"
                    :class="priorityClass(item.priority)">
                    <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {{ PRIORITY_LABELS[item.priority] }}
                  </span>
                  <span v-if="item.dueDate"
                    class="rounded px-1.5 py-0.5 text-[12px] font-medium"
                    :class="isOverdue(item.dueDate) && !item.isCompleted
                      ? 'bg-danger-soft text-danger-ink'
                      : 'bg-sunken text-ink-soft'">
                    {{ describeDue(item.dueDate) }}<template v-if="item.dueTime"> {{ item.dueTime }}</template>
                  </span>
                  <span v-if="item.recurrence"
                    class="rounded bg-sunken px-1.5 py-0.5 text-[12px] text-ink-soft">
                    ↻ {{ describeRecurrence(item.recurrence) }}
                  </span>
                  <span v-if="projectOf(item)"
                    class="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-medium text-accent-ink">
                    {{ projectOf(item)?.name }}
                  </span>
                  <span v-for="tag in tagsOf(item)" :key="tag.id"
                    class="rounded bg-success-soft px-1.5 py-0.5 text-[12px] font-medium text-success-ink">
                    #{{ tag.name }}
                  </span>
                </p>
              </div>

              <!--
                動作列在觸控裝置一律可見；指標裝置上平時淡出，
                hover 或內部有焦點時才完全顯現。用 focus-within 才不會讓
                鍵盤使用者 Tab 到看不見的按鈕。
              -->
              <div
                class="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                <button type="button" :disabled="index === 0"
                  :aria-label="`將「${item.taskName}」上移`"
                  class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  @click="moveUp(index)">↑</button>
                <button type="button" :disabled="index === taskList.length - 1"
                  :aria-label="`將「${item.taskName}」下移`"
                  class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  @click="moveDown(index)">↓</button>
                <button v-if="editingId !== item.id" type="button"
                  :aria-label="`編輯「${item.taskName}」`"
                  class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                  @click="editTask(item)">
                  <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none"
                    stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
                    <path d="M11.2 2.3 13.7 4.8 5.5 13H3v-2.5Z" />
                  </svg>
                </button>
                <button v-else type="button" :aria-label="`保存「${item.taskName}」`"
                  class="grid size-7 place-items-center rounded text-accent transition-colors hover:bg-accent-soft"
                  @click="saveTask(item)">
                  <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none"
                    stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                </button>
                <button type="button" :aria-label="`設定「${item.taskName}」的細節`"
                  class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                  @click="detailTask = item">
                  <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="currentColor">
                    <circle cx="3.5" cy="8" r="1.2" />
                    <circle cx="8" cy="8" r="1.2" />
                    <circle cx="12.5" cy="8" r="1.2" />
                  </svg>
                </button>
                <button type="button" :aria-label="`刪除「${item.taskName}」`"
                  class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
                  @click="deleteTask(item.id)">
                  <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
                  </svg>
                </button>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <TaskDetailDialog :task="detailTask" @close="detailTask = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import TaskDetailDialog from './TaskDetailDialog.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { FILTERS, type TaskFilter } from '@/router/filters'
import { PRIORITY_LABELS, type Priority, type StoredTask } from '@/db/schema'
import { describeDue, isOverdue } from '@/domain/dates'
import { describeRecurrence } from '@/domain/recurrence'
import { normalizeForSearch } from '@/utils/search'

// 篩選狀態由路由決定，不再存在 store 裡（原本的 pages 數字已移除）。
const props = withDefaults(defineProps<{ filter?: TaskFilter }>(), { filter: 'all' })

const store = useTodoTaskStore()

// 稽核 P1：編輯狀態是 UI 暫態，改為元件區域狀態，不隨 todoList 被持久化。
const editingId = ref<string | null>(null)
const editTaskName = ref('')
const draggingId = ref<string | null>(null)
const detailTask = ref<StoredTask | null>(null)

const editTask = (task: StoredTask) => {
  if (editingId.value !== null) {
    alert('有待辦事項尚未保存，請先完成編輯')
    return
  }
  editingId.value = task.id
  editTaskName.value = task.taskName
}

const saveTask = (task: StoredTask) => {
  if (editTaskName.value === '') {
    alert('請輸入編輯內容')
    return
  }
  store.updateTask(task.id, { taskName: editTaskName.value })
  editingId.value = null
  editTaskName.value = ''
}

const cancelEdit = () => {
  editingId.value = null
  editTaskName.value = ''
}

const deleteTask = (id: string) => {
  // 刪掉的正好是編輯中的那筆時一併結束編輯，否則殘留的 editingId 會鎖住其他項目
  if (editingId.value === id) cancelEdit()
  store.removeTask(id)
}

/** 只取頂層任務並套用關鍵字，供各分頁再過濾。 */
const visible = computed<StoredTask[]>(() => {
  // 稽核 P4：NFKC 正規化後比對，涵蓋大小寫與全形半形
  const keyword = normalizeForSearch(store.keyword)
  const matched =
    keyword === ''
      ? store.todoList
      : store.todoList.filter((item) => normalizeForSearch(item.taskName).includes(keyword))
  return [...matched.filter((item) => item.parentId === null)].sort((a, b) => a.order - b.order)
})

const byFilter = (list: StoredTask[], filter: TaskFilter): StoredTask[] => {
  // 稽核 P3：filter 是封閉聯集且有 default 收尾，型別層面就不會有未涵蓋的值
  switch (filter) {
    case 'active':
      return list.filter((item) => !item.isCompleted)
    case 'completed':
      return list.filter((item) => item.isCompleted)
    default:
      return list
  }
}

const taskList = computed(() => byFilter(visible.value, props.filter))
const countOf = (filter: TaskFilter) => byFilter(visible.value, filter).length

const emptyMessage = computed(() => {
  if (store.keyword !== '') return `找不到符合「${store.keyword}」的代辦事項`
  switch (props.filter) {
    case 'active':
      return '沒有未完成的代辦事項'
    case 'completed':
      return '還沒有已完成的代辦事項'
    default:
      return '目前沒有代辦事項，從上方新增一筆吧'
  }
})

const hasMeta = (task: StoredTask) =>
  task.priority > 0 ||
  task.dueDate !== null ||
  task.recurrence !== null ||
  task.projectId !== null ||
  task.tagIds.length > 0

const priorityClass = (priority: Priority) =>
  ({ 0: '', 1: 'text-p1', 2: 'text-p2', 3: 'text-p3' })[priority]

const tagsOf = (task: StoredTask) => store.tags.filter((t) => task.tagIds.includes(t.id))
const projectOf = (task: StoredTask) => store.projects.find((p) => p.id === task.projectId) ?? null

// --- 排序 ---
const onDrop = (targetId: string) => {
  if (draggingId.value && draggingId.value !== targetId) {
    store.moveTask(draggingId.value, targetId, 'before')
  }
  draggingId.value = null
}
const moveUp = (index: number) => {
  const current = taskList.value[index]
  const previous = taskList.value[index - 1]
  if (current && previous) store.moveTask(current.id, previous.id, 'before')
}
const moveDown = (index: number) => {
  const current = taskList.value[index]
  const next = taskList.value[index + 1]
  if (current && next) store.moveTask(current.id, next.id, 'after')
}
</script>
