<template>
  <!-- 原生 <dialog> 的 showModal() 由平台提供焦點鎖定、Esc 關閉與背景 inert。
       這正是不引入元件庫的原因：實測 reka-ui 光是 Dialog 就要 +26.10 kB gzip，
       而這些行為瀏覽器本來就給。 -->
  <dialog ref="dialogEl" class="w-[min(92vw,32rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <form v-if="draft" method="dialog" class="flex flex-col gap-4 p-5" @submit.prevent="save">
      <h2 class="text-lg font-semibold tracking-tight">編輯代辦事項</h2>

      <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
        名稱
        <input v-model.trim="draft.taskName" required
          class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
      </label>

      <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
        備註
        <textarea v-model="draft.notes" rows="2"
          class="min-h-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none" />
      </label>

      <div class="flex flex-wrap gap-3">
        <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          優先度
          <select v-model.number="draft.priority"
            class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
            <option v-for="(label, value) in PRIORITY_LABELS" :key="value" :value="Number(value)">
              {{ label }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          到期日
          <input v-model="dueDateInput" type="date"
            class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
        </label>

        <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
          時間
          <input v-model="dueTimeInput" type="time" :disabled="!dueDateInput"
            class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none disabled:bg-sunken disabled:text-ink-faint">
        </label>
      </div>

      <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
        專案
        <select v-model="projectInput"
          class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
          <option value="">未分類</option>
          <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>

      <!-- 就地建立：沒有這條路徑的話，第一次使用時專案與標籤永遠是空清單 -->
      <div class="flex gap-2">
        <input v-model.trim="newProjectName" aria-label="新專案名稱" placeholder="新增專案…"
          class="h-9 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="createProject">
        <button type="button" class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          :disabled="newProjectName === ''" @click="createProject">建立</button>
      </div>

      <fieldset class="rounded-lg border border-line p-3">
        <legend class="px-1 text-sm font-medium text-ink-soft">標籤</legend>
        <p v-if="store.tags.length === 0" class="mb-2 text-sm text-ink-faint">尚未建立任何標籤</p>
        <label v-for="tag in store.tags" :key="tag.id"
          class="mr-3 inline-flex items-center gap-1.5 text-[15px] text-ink">
          <input type="checkbox" :value="tag.id" :checked="draft.tagIds.includes(tag.id)"
            class="size-4 accent-accent" @change="toggleTag(tag.id)">
          {{ tag.name }}
        </label>
        <div class="mt-2 flex gap-2">
          <input v-model.trim="newTagName" aria-label="新標籤名稱" placeholder="新增標籤…"
            class="h-9 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @keydown.enter.prevent="createTag">
          <button type="button" class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="newTagName === ''" @click="createTag">建立</button>
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2.5 rounded-lg border border-line p-3">
        <legend class="px-1 text-sm font-medium text-ink-soft">重複</legend>
        <label class="inline-flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="draft.recurrence !== null" class="size-4 accent-accent"
            @change="toggleRecurrence">
          啟用重複
        </label>

        <template v-if="draft.recurrence">
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
              頻率
              <select v-model="draft.recurrence.freq"
                class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
                <option value="daily">每日</option>
                <option value="weekly">每週</option>
                <option value="monthly">每月</option>
              </select>
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
              間隔
              <input v-model.number="draft.recurrence.interval" type="number" min="1"
                class="h-9 w-20 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
            </label>
          </div>

          <div v-if="draft.recurrence.freq === 'weekly'" class="flex flex-wrap gap-2">
            <label v-for="day in WEEKDAYS" :key="day"
              class="inline-flex items-center gap-1.5 text-[15px] text-ink">
              <input type="checkbox" :checked="draft.recurrence.byDay.includes(day)" class="size-4 accent-accent"
                @change="toggleWeekday(day)">
              {{ WEEKDAY_LABELS[day] }}
            </label>
          </div>

          <p v-if="!dueDateInput" class="text-sm text-danger-ink">
            重複需要搭配到期日才會生效
          </p>
          <p v-else class="text-sm text-ink-faint">{{ describeRecurrence(draft.recurrence) }}</p>
        </template>
      </fieldset>

      <div class="flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken"
          @click="close">取消</button>
        <button type="submit" class="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover">儲存</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import {
  PRIORITY_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type StoredTask,
  type Weekday,
} from '@/db/schema'
import { DEFAULT_RECURRENCE, describeRecurrence } from '@/domain/recurrence'
import { isValidISODate, isValidTime } from '@/domain/dates'

const props = defineProps<{ task: StoredTask | null }>()
const emit = defineEmits<{ close: [] }>()

const store = useTodoTaskStore()
const dialogEl = ref<HTMLDialogElement | null>(null)
const draft = ref<StoredTask | null>(null)
const dueDateInput = ref('')
const dueTimeInput = ref('')
const projectInput = ref('')
const newProjectName = ref('')
const newTagName = ref('')

/** 建立後直接選中，省去「建立完還要再選一次」的來回。 */
function createProject(): void {
  if (newProjectName.value === '') return
  projectInput.value = store.addProject(newProjectName.value).id
  newProjectName.value = ''
}

function createTag(): void {
  if (newTagName.value === '' || !draft.value) return
  const tag = store.addTag(newTagName.value)
  draft.value.tagIds = [...draft.value.tagIds, tag.id]
  newTagName.value = ''
}

watch(
  () => props.task,
  (task) => {
    if (!task) {
      dialogEl.value?.close()
      draft.value = null
      return
    }
    draft.value = { ...task, tagIds: [...task.tagIds], recurrence: task.recurrence ? { ...task.recurrence, byDay: [...task.recurrence.byDay] } : null }
    dueDateInput.value = task.dueDate ?? ''
    dueTimeInput.value = task.dueTime ?? ''
    projectInput.value = task.projectId ?? ''
    // showModal 才有焦點鎖定與背景 inert；show() 沒有
    dialogEl.value?.showModal()
  },
)

function close(): void {
  dialogEl.value?.close()
}

function toggleTag(tagId: string): void {
  if (!draft.value) return
  draft.value.tagIds = draft.value.tagIds.includes(tagId)
    ? draft.value.tagIds.filter((t) => t !== tagId)
    : [...draft.value.tagIds, tagId]
}

function toggleRecurrence(): void {
  if (!draft.value) return
  draft.value.recurrence = draft.value.recurrence ? null : { ...DEFAULT_RECURRENCE, byDay: [] }
}

function toggleWeekday(day: Weekday): void {
  const rule = draft.value?.recurrence
  if (!rule) return
  rule.byDay = rule.byDay.includes(day)
    ? rule.byDay.filter((d) => d !== day)
    : [...rule.byDay, day]
}

function save(): void {
  const current = draft.value
  if (!current || current.taskName.trim() === '') return

  const dueDate = isValidISODate(dueDateInput.value) ? dueDateInput.value : null
  store.updateTask(current.id, {
    taskName: current.taskName.trim(),
    notes: current.notes,
    priority: current.priority,
    dueDate,
    // 沒有日期的時間沒有意義
    dueTime: dueDate !== null && isValidTime(dueTimeInput.value) ? dueTimeInput.value : null,
    projectId: projectInput.value === '' ? null : projectInput.value,
    tagIds: current.tagIds,
    recurrence: current.recurrence,
  })
  close()
}
</script>

<style scoped></style>
