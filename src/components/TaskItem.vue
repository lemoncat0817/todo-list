<template>
  <!--
    拖曳是指標裝置的增強，不是唯一路徑：每列都提供上移／下移按鈕，
    鍵盤與螢幕閱讀器使用者走那條路。這正是該 lint 規則要保護的東西。
  -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <li draggable="true" data-test="task-row"
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
        <p v-if="!editing" data-test="task-name" class="break-words text-[15px] leading-snug"
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

        <!-- 子任務：資料層一直支援，先前畫面上沒有任何入口 -->
        <div v-if="children.length > 0" class="mt-1.5">
          <button type="button" :aria-expanded="expanded"
            :aria-label="`${expanded ? '收合' : '展開'}「${task.taskName}」的子任務`"
            class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] font-medium transition-colors hover:bg-sunken"
            :class="allChildrenDone ? 'text-success-ink' : 'text-ink-soft'"
            @click="emit('toggle-expand')">
            <svg viewBox="0 0 12 12" class="size-3 transition-transform"
              :class="{ 'rotate-90': expanded }" aria-hidden="true" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
            </svg>
            子任務 {{ doneChildren }}/{{ children.length }}
          </button>

          <ul v-if="expanded" class="mt-1 flex flex-col gap-1 border-l border-line pl-3">
            <li v-for="child in children" :key="child.id" class="flex items-center gap-2">
              <input :checked="child.isCompleted" type="checkbox"
                :aria-label="`標記子任務「${child.taskName}」為已完成`"
                class="size-4 shrink-0 cursor-pointer accent-accent"
                @change="emit('toggle-child', child.id)">
              <span class="min-w-0 grow break-words text-[13px]"
                :class="child.isCompleted ? 'text-ink-faint line-through' : 'text-ink-soft'">
                {{ child.taskName }}
              </span>
              <button type="button" :aria-label="`刪除子任務「${child.taskName}」`"
                class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
                @click="emit('remove-child', child.id)">
                <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none"
                  stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </li>
          </ul>
        </div>

        <div v-if="addingSub" class="mt-1.5 flex gap-2">
          <input ref="subInput" v-model.trim="subDraft" :aria-label="`「${task.taskName}」的新子任務`"
            placeholder="子任務…"
            class="h-8 min-w-0 grow rounded-md border border-accent bg-surface px-2 text-[13px] text-ink focus:outline-none"
            @keyup.enter="commitSub" @keyup.esc="cancelSub">
          <button type="button"
            class="shrink-0 rounded-md bg-accent px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="subDraft === ''" @click="commitSub">
            加入
          </button>
        </div>
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

        <DueDateMenu :task-name="task.taskName" :has-due-date="task.dueDate !== null"
          @pick="(d) => emit('reschedule', d)" />

        <!-- 用「加入」而非「新增」：新增代辦事項那顆按鈕的可及名稱是「新增」，
             兩者互相包含會讓依名稱定位的工具（含輔助科技的搜尋）分不出來 -->
        <button type="button" :aria-label="`加入「${task.taskName}」的子任務`"
          class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="startSub">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round">
            <path d="M3 4.5h10M3 8h6M6 11.5h3M11.5 9.5v4M9.5 11.5h4" />
          </svg>
        </button>

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
import { computed, nextTick, ref, watch } from 'vue'
import TaskMeta from './TaskMeta.vue'
import DueDateMenu from './DueDateMenu.vue'
import type { StoredTask } from '@/db/schema'
import { isEffectivelyComplete } from '@/domain/task'

/**
 * 單一任務列。
 *
 * 刻意做成受控元件：所有變更以事件往外送，自己不碰 store。
 * 這樣它可以被單獨測試，而清單元件也不必知道一列裡面有哪些按鈕。
 *
 * 子任務只渲染一層，不遞迴用自己：一層是 domain/task.ts 明確定下的限制，
 * 遞迴會讓「這個限制在哪裡被保證」變得不明顯。
 */
const props = withDefaults(
  defineProps<{
    task: StoredTask
    editing: boolean
    dragging: boolean
    /** 這一列正顯示在詳情面板裡——寬螢幕需要看得出面板對應的是哪一列 */
    selected: boolean
    isFirst: boolean
    isLast: boolean
    children?: StoredTask[]
    expanded?: boolean
  }>(),
  { children: () => [], expanded: false },
)

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
  reschedule: [dueDate: string | null]
  'toggle-expand': []
  'add-subtask': [name: string]
  'toggle-child': [id: string]
  'remove-child': [id: string]
}>()

const draft = ref('')
const editInput = ref<HTMLInputElement | null>(null)
const addingSub = ref(false)
const subDraft = ref('')
const subInput = ref<HTMLInputElement | null>(null)

const doneChildren = computed(() => props.children.filter((c) => c.isCompleted).length)
const allChildrenDone = computed(() => isEffectivelyComplete(props.task, props.children))

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

async function startSub(): Promise<void> {
  addingSub.value = true
  await nextTick()
  subInput.value?.focus()
}

function cancelSub(): void {
  addingSub.value = false
  subDraft.value = ''
}

/** 新增後輸入框留著並保持焦點：子任務通常是一次列好幾條，不是一條。 */
function commitSub(): void {
  if (subDraft.value === '') return
  emit('add-subtask', subDraft.value)
  subDraft.value = ''
  subInput.value?.focus()
}
</script>
