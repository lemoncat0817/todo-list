<template>
  <!--
    拖曳是指標裝置的增強，不是唯一路徑：每列都提供上移／下移按鈕，
    鍵盤與螢幕閱讀器使用者走那條路。這正是該 lint 規則要保護的東西。
  -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <li draggable="true"
    class="group animate-rise rounded-lg border bg-surface px-3 py-2.5 transition-colors"
    :class="[
      dragging ? 'opacity-50' : '',
      selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
    ]" @dragstart="emit('dragstart')" @dragover.prevent
    @drop="emit('drop')" @dragend="emit('dragend')">
    <div class="flex items-start gap-3">
      <input :checked="task.isCompleted" type="checkbox"
        :aria-label="`標記「${task.taskName}」為已完成`"
        class="mt-0.5 size-4.5 shrink-0 cursor-pointer accent-accent" @change="emit('toggle')">

      <div class="min-w-0 grow">
        <p v-if="!editing" class="break-words text-[15px] leading-snug"
          :class="task.isCompleted ? 'text-ink-faint line-through' : 'text-ink'">
          {{ task.taskName }}
        </p>
        <input v-else ref="editInput" v-model="draft" :aria-label="`編輯「${task.taskName}」`"
          placeholder="輸入內容"
          class="w-full rounded-md border border-accent bg-surface px-2 py-1 text-[15px] text-ink focus:outline-none"
          @keyup.enter="commit" @keyup.esc="emit('cancel-edit')">

        <p v-if="task.notes && !editing" class="mt-1 line-clamp-2 text-[13px] text-ink-faint">
          {{ task.notes }}
        </p>

        <TaskMeta :task="task" />
      </div>

      <!--
        動作列在觸控裝置常駐；指標裝置上平時淡出，hover 或內部有焦點時顯現。
        用 focus-within 才不會讓鍵盤使用者 Tab 到看不見的按鈕。
      -->
      <div
        class="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        <button type="button" :disabled="isFirst" :aria-label="`將「${task.taskName}」上移`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          @click="emit('move-up')">↑</button>
        <button type="button" :disabled="isLast" :aria-label="`將「${task.taskName}」下移`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          @click="emit('move-down')">↓</button>

        <button v-if="!editing" type="button" :aria-label="`編輯「${task.taskName}」`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('start-edit')">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linejoin="round">
            <path d="M11.2 2.3 13.7 4.8 5.5 13H3v-2.5Z" />
          </svg>
        </button>
        <button v-else type="button" :aria-label="`保存「${task.taskName}」`"
          class="grid size-7 place-items-center rounded text-accent transition-colors hover:bg-accent-soft"
          @click="commit">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </button>

        <button type="button" :aria-label="`設定「${task.taskName}」的細節`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('open-detail')">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="12.5" cy="8" r="1.2" />
          </svg>
        </button>
        <button type="button" :aria-label="`刪除「${task.taskName}」`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
          @click="emit('remove')">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round">
            <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
          </svg>
        </button>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import TaskMeta from './TaskMeta.vue'
import type { StoredTask } from '@/db/schema'

/**
 * 單一任務列。
 *
 * 刻意做成受控元件：所有變更以事件往外送，自己不碰 store。
 * 這樣它可以被單獨測試、在別的清單（例如子任務）重用，
 * 而清單元件也不必知道一列裡面有哪些按鈕。
 */
const props = defineProps<{
  task: StoredTask
  editing: boolean
  dragging: boolean
  /** 這一列正顯示在詳情面板裡——寬螢幕需要看得出面板對應的是哪一列 */
  selected: boolean
  isFirst: boolean
  isLast: boolean
}>()

const emit = defineEmits<{
  toggle: []
  remove: []
  'start-edit': []
  'cancel-edit': []
  save: [name: string]
  'open-detail': []
  'move-up': []
  'move-down': []
  dragstart: []
  drop: []
  dragend: []
}>()

const draft = ref('')
const editInput = ref<HTMLInputElement | null>(null)

// 進入編輯時帶入原文字並聚焦——少了聚焦，使用者得多點一次才能打字
watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return
    draft.value = props.task.taskName
    await nextTick()
    editInput.value?.focus()
    editInput.value?.select()
  },
  { immediate: true },
)

function commit(): void {
  const name = draft.value.trim()
  // 空白不是有效名稱；直接忽略而不是跳對話框責備使用者
  if (name === '') return
  emit('save', name)
}
</script>
