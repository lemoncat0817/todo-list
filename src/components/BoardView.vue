<template>
  <div class="min-h-0 grow overflow-x-auto overflow-y-hidden px-4 py-3 sm:px-6">
    <div class="flex h-full min-h-0 items-start gap-3">
      <!--
        拖曳是滑鼠使用者的加強，不是唯一路徑——每張卡片下方的上移/下移
        按鈕跟「移到...」選單才是真正的鍵盤/螢幕閱讀器路徑，跟
        TaskItem.vue 的 <li draggable> 同一個判斷（那裡也有一模一樣的
        disable 註解）。
      -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <section v-for="(column, colIndex) in columns" :key="column.id ?? 'unassigned'"
        class="flex h-full w-72 shrink-0 flex-col rounded-lg border border-line bg-sunken"
        @dragover.prevent @drop="dropOnColumn(column.id)">
        <div class="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
          <template v-if="renamingId === column.id && column.id !== null">
            <label class="sr-only" :for="`rename-${column.id}`">區段名稱</label>
            <input :id="`rename-${column.id}`" v-model.trim="renameDraft" class="h-7 min-w-0 grow rounded border border-line bg-surface px-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              @keydown.enter="commitRename" @keydown.esc="renamingId = null" @blur="commitRename">
          </template>
          <h2 v-else class="min-w-0 grow truncate text-sm font-semibold tracking-tight text-ink-soft">
            {{ column.name }}
            <span class="font-normal text-ink-faint">{{ column.tasks.length }}</span>
          </h2>

          <template v-if="column.id !== null && workspace.canWriteTasks">
            <button type="button" aria-label="欄位左移" :disabled="colIndex <= 1"
              class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
              @click="moveColumn(column.id, -1)">
              <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m10 3-5 5 5 5" /></svg>
            </button>
            <button type="button" aria-label="欄位右移" :disabled="colIndex >= columns.length - 1"
              class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
              @click="moveColumn(column.id, 1)">
              <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 3 5 5-5 5" /></svg>
            </button>
            <button type="button" :aria-label="`重新命名「${column.name}」`"
              class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-surface hover:text-ink"
              @click="startRename(column.id, column.name)">
              <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5 13.5 5 5 13.5H2.5V11L11 2.5Z" /></svg>
            </button>
            <button type="button" :aria-label="`刪除區段「${column.name}」`"
              class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
              @click="tasks.removeSection(column.id)">
              <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.5 9.5h6L11.5 4" /></svg>
            </button>
          </template>
        </div>

        <ul class="flex min-h-16 grow flex-col gap-1.5 overflow-y-auto p-2">
          <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions, vuejs-accessibility/click-events-have-key-events -->
          <li v-for="(item, index) in column.tasks" :key="item.id" :draggable="workspace.canWriteTasks"
            class="animate-rise rounded-lg border border-line bg-surface p-2.5 transition-colors focus-within:outline-none"
            :class="draggingId === item.id ? 'opacity-50' : ''"
            @dragstart="draggingId = item.id" @dragend="draggingId = null"
            @dragover.prevent.stop @drop.stop="dropOnCard(column.id, item.id)">
            <div class="flex items-start gap-2">
              <input :checked="item.isCompleted" type="checkbox"
                :aria-label="`標記「${item.taskName}」為已完成`"
                :disabled="!workspace.canWriteTasks"
                class="mt-0.5 size-4 shrink-0 accent-accent" @change="tasks.toggle(item.id)">
              <button type="button" class="min-w-0 grow break-words text-left text-sm text-ink"
                @click="ui.openDetail(item.id)">
                {{ item.taskName }}
              </button>
            </div>
            <TaskMeta :task="item" />

            <!--
              拖曳是滑鼠使用者的加強，不是唯一路徑——跟 TaskItem.vue 同一個
              判斷：上移/下移按鈕跟「移到...」選單才是真正的鍵盤/螢幕
              閱讀器路徑。
            -->
            <div v-if="workspace.canWriteTasks" class="mt-2 flex items-center gap-1 border-t border-line pt-1.5">
              <button type="button" :aria-label="`「${item.taskName}」在欄內上移`" :disabled="index === 0"
                class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:opacity-30"
                @click="moveWithinColumn(column, index, -1)">
                <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m3 10 5-5 5 5" /></svg>
              </button>
              <button type="button" :aria-label="`「${item.taskName}」在欄內下移`" :disabled="index === column.tasks.length - 1"
                class="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink disabled:opacity-30"
                @click="moveWithinColumn(column, index, 1)">
                <svg viewBox="0 0 16 16" class="size-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m3 6 5 5 5-5" /></svg>
              </button>
              <label class="sr-only" :for="`move-to-${item.id}`">移到區段</label>
              <select :id="`move-to-${item.id}`" class="h-6 min-w-0 grow rounded border border-line bg-surface px-1 text-xs text-ink-soft"
                :value="column.id ?? ''" @change="moveToColumn(item.id, ($event.target as HTMLSelectElement).value)">
                <option value="">未分類</option>
                <option v-for="s in allSections" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
          </li>
        </ul>

        <form v-if="workspace.canWriteTasks" class="flex shrink-0 items-center gap-1.5 border-t border-line p-2" @submit.prevent="addTask(column.id)">
          <label class="sr-only" :for="`add-task-${column.id ?? 'unassigned'}`">在「{{ column.name }}」新增任務</label>
          <input :id="`add-task-${column.id ?? 'unassigned'}`" v-model.trim="draftByColumn[column.id ?? '']"
            placeholder="新增任務…"
            class="h-8 min-w-0 grow rounded-md border border-line bg-surface px-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          <button type="submit" aria-label="新增任務" :disabled="!(draftByColumn[column.id ?? ''] ?? '')"
            class="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40">
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        </form>
      </section>

      <form v-if="workspace.canWriteTasks" class="w-64 shrink-0 rounded-lg border border-dashed border-line p-2" @submit.prevent="addSection">
        <label class="sr-only" for="new-section-name">新區段名稱</label>
        <div class="flex items-center gap-1.5">
          <input id="new-section-name" v-model.trim="newSectionName" placeholder="新增區段…"
            class="h-8 min-w-0 grow rounded-md border border-line bg-surface px-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          <button type="submit" aria-label="新增區段" :disabled="newSectionName === ''"
            class="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40">
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useSectionsStore } from '@/stores/sections'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import TaskMeta from './TaskMeta.vue'
import type { StoredTask } from '@/db/schema'

/**
 * 看板檢視（M5）。專案內以區段為欄，跟清單檢視共用同一組資料與排序鍵
 * （tasks.rank）——這裡的拖曳／上移下移改的就是 stores/tasks.ts 的
 * moveToSection()，跟清單檢視的 move() 是同一套 domain/rank.ts 數學，
 * 只是排序範圍限定在「同一個區段」而非全域，所以在兩個檢視之間切換、
 * 或分別在兩台裝置操作，看到的順序永遠一致。
 *
 * 子任務不上看板：卡片只代表頂層任務，跟清單檢視「子任務只在展開父項
 * 後才看得到」是同一種「子任務是父項的附屬細節，不是獨立看板項目」的
 * 判斷。已完成的任務也不上看板——跟專案清單檢視排除已完成一致，
 * 完成的事屬於「已完成」那個歷史檢視。
 */
const props = defineProps<{ projectId: string }>()

const tasks = useTasksStore()
const sections = useSectionsStore()
const ui = useUiStore()
const workspace = useWorkspaceStore()

interface Column {
  /** null 代表「未分類」——不是真的區段，不能改名/刪除/搬動。 */
  id: string | null
  name: string
  tasks: StoredTask[]
}

const columns = computed<Column[]>(() => {
  const inThisProject = tasks.items.filter(
    (t) => t.projectId === props.projectId && !t.isCompleted && t.parentId === null,
  )
  const unassigned: Column = {
    id: null,
    name: '未分類',
    tasks: inThisProject.filter((t) => t.sectionId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
  }
  const real: Column[] = sections.forProject(props.projectId).map((s) => ({
    id: s.id,
    name: s.name,
    tasks: inThisProject.filter((t) => t.sectionId === s.id).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
  }))
  return [unassigned, ...real]
})

const allSections = computed(() => sections.forProject(props.projectId))

const draggingId = ref<string | null>(null)

function dropOnColumn(sectionId: string | null): void {
  if (!workspace.canWriteTasks) return
  if (draggingId.value) tasks.moveToSection(draggingId.value, sectionId, null)
  draggingId.value = null
}

function dropOnCard(sectionId: string | null, targetId: string): void {
  if (draggingId.value && draggingId.value !== targetId) {
    tasks.moveToSection(draggingId.value, sectionId, targetId, 'before')
  }
  draggingId.value = null
}

/** 在同一欄內上移／下移——跟清單檢視的 move() 按鈕同一種鍵盤可達路徑。 */
function moveWithinColumn(column: Column, index: number, delta: -1 | 1): void {
  const current = column.tasks[index]
  const neighbour = column.tasks[index + delta]
  if (current && neighbour) tasks.moveToSection(current.id, column.id, neighbour.id, delta === -1 ? 'before' : 'after')
}

/** 選單版的跨欄移動——不用拖曳也能把卡片搬到別的區段，附加到該欄最後面。 */
function moveToColumn(taskId: string, sectionId: string): void {
  tasks.moveToSection(taskId, sectionId === '' ? null : sectionId, null)
}

const renamingId = ref<string | null>(null)
const renameDraft = ref('')
function startRename(id: string, name: string): void {
  renamingId.value = id
  renameDraft.value = name
}
function commitRename(): void {
  if (renamingId.value !== null && renameDraft.value !== '') {
    sections.renameSection(renamingId.value, renameDraft.value)
  }
  renamingId.value = null
}

function moveColumn(id: string, delta: -1 | 1): void {
  const index = allSections.value.findIndex((s) => s.id === id)
  const neighbour = allSections.value[index + delta]
  if (neighbour) sections.moveSection(id, neighbour.id, delta === -1 ? 'before' : 'after')
}

const newSectionName = ref('')
function addSection(): void {
  if (newSectionName.value === '') return
  sections.addSection(props.projectId, newSectionName.value)
  newSectionName.value = ''
}

/** key 是區段 id，未分類用空字串——reactive 物件比 Map 更適合直接綁在 v-model 上。 */
const draftByColumn = reactive<Record<string, string>>({})
function addTask(sectionId: string | null): void {
  const key = sectionId ?? ''
  const name = (draftByColumn[key] ?? '').trim()
  if (name === '') return
  tasks.add(name, { projectId: props.projectId, sectionId })
  draftByColumn[key] = ''
}
</script>
