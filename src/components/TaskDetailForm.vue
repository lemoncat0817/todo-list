<template>
  <form v-if="draft" class="flex flex-col gap-4" @submit.prevent="save">
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
          <option v-for="p in PRIORITY_ORDER" :key="p" :value="p">{{ PRIORITY_DESCRIPTIONS[p] }}</option>
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
        <option v-for="p in collections.visibleProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <!-- 就地建立：沒有這條路徑的話，第一次使用時專案與標籤永遠是空清單 -->
    <div class="flex gap-2">
      <input v-model.trim="newProjectName" aria-label="新專案名稱" placeholder="新增專案…"
        :aria-invalid="projectNameError !== null"
        class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        @keydown.enter.prevent="createProject">
      <button type="button"
        class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        :disabled="newProjectName === '' || projectNameError !== null" @click="createProject">建立</button>
    </div>
    <p v-if="projectNameError" class="-mt-2 text-xs text-danger-ink">{{ projectNameError }}</p>

    <fieldset class="rounded-lg border border-line p-3">
      <legend class="px-1 text-sm font-medium text-ink-soft">標籤</legend>
      <p v-if="collections.tags.length === 0" class="mb-2 text-sm text-ink-faint">尚未建立任何標籤</p>
      <label v-for="tag in collections.tags" :key="tag.id"
        class="mr-3 inline-flex items-center gap-1.5 text-[15px] text-ink">
        <input type="checkbox" :value="tag.id" :checked="draft.tagIds.includes(tag.id)"
          class="size-4 accent-accent" @change="toggleTag(tag.id)">
        <span class="size-2.5 rounded-full" :style="{ backgroundColor: tag.color }" aria-hidden="true" />
        {{ tag.name }}
      </label>
      <div class="mt-2 flex gap-2">
        <input v-model.trim="newTagName" aria-label="新標籤名稱" placeholder="新增標籤…"
          :aria-invalid="tagNameError !== null"
          class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          @keydown.enter.prevent="createTag">
        <button type="button"
          class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          :disabled="newTagName === '' || tagNameError !== null" @click="createTag">建立</button>
      </div>
      <p v-if="tagNameError" class="mt-1 text-xs text-danger-ink">{{ tagNameError }}</p>
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

        <p v-if="!dueDateInput" class="text-sm text-danger-ink">重複需要搭配到期日才會生效</p>
        <p v-else class="text-sm text-ink-faint">{{ describeRecurrence(draft.recurrence) }}</p>
      </template>
    </fieldset>

    <div class="flex justify-end gap-2 border-t border-line pt-4">
      <button type="button"
        class="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken"
        @click="emit('close')">取消</button>
      <button type="submit"
        class="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover">儲存</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import {
  PRIORITY_DESCRIPTIONS,
  PRIORITY_ORDER,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type StoredTask,
  type Weekday,
} from '@/db/schema'
import { DEFAULT_RECURRENCE, describeRecurrence } from '@/domain/recurrence'
import { isValidISODate, isValidTime } from '@/domain/dates'
import { findByNormalizedName } from '@/domain/filtering'

/**
 * 任務詳情的表單本體。
 *
 * 從對話框裡抽出來，是因為同一份表單現在有兩種容器：寬螢幕是常駐的右側面板，
 * 窄螢幕是原生 <dialog>。容器負責「怎麼出現」，這裡只負責「有哪些欄位」——
 * 兩者混在一起的話，加一個欄位就得改兩個地方。
 *
 * 編輯的是一份 draft 副本而不是任務本身：按「取消」必須真的什麼都沒變，
 * 直接綁 store 裡的物件會邊打字邊寫入。
 */
const props = defineProps<{ task: StoredTask | null }>()
const emit = defineEmits<{ close: [] }>()

const tasks = useTasksStore()
const collections = useCollectionsStore()

const draft = ref<StoredTask | null>(null)
const dueDateInput = ref('')
const dueTimeInput = ref('')
const projectInput = ref('')
const newProjectName = ref('')
const newTagName = ref('')

watch(
  () => props.task,
  (task) => {
    if (!task) {
      draft.value = null
      return
    }
    draft.value = {
      ...task,
      tagIds: [...task.tagIds],
      recurrence: task.recurrence ? { ...task.recurrence, byDay: [...task.recurrence.byDay] } : null,
    }
    dueDateInput.value = task.dueDate ?? ''
    dueTimeInput.value = task.dueTime ?? ''
    projectInput.value = task.projectId ?? ''
  },
  { immediate: true },
)

/**
 * 同名（忽略大小寫／全形半形）就擋掉建立，而不是靜默重用——
 * 這裡上面已經有下拉選單／核取方塊可以直接選到既有項目，
 * 讓「建立」按鈕對一個已存在的名字生效只會讓人以為自己多建了一個。
 */
const projectNameError = computed(() =>
  // 用未過濾的 projects：跟收件匣同名也要擋，理由同 CollectionsDialog.vue
  // 的 projectNameError——store 的重名防線比對全量，這裡要一致。
  newProjectName.value !== '' && findByNormalizedName(collections.projects, newProjectName.value)
    ? '已有相同名稱的專案，請從上方選單選取'
    : null,
)

const tagNameError = computed(() =>
  newTagName.value !== '' && findByNormalizedName(collections.tags, newTagName.value)
    ? '已有相同名稱的標籤，請從上方勾選'
    : null,
)

/** 建立後直接選中，省去「建立完還要再選一次」的來回。 */
function createProject(): void {
  if (newProjectName.value === '' || projectNameError.value) return
  projectInput.value = collections.addProject(newProjectName.value).id
  newProjectName.value = ''
}

function createTag(): void {
  if (newTagName.value === '' || tagNameError.value || !draft.value) return
  const tag = collections.addTag(newTagName.value)
  draft.value.tagIds = [...draft.value.tagIds, tag.id]
  newTagName.value = ''
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
  rule.byDay = rule.byDay.includes(day) ? rule.byDay.filter((d) => d !== day) : [...rule.byDay, day]
}

function save(): void {
  const current = draft.value
  if (!current || current.taskName.trim() === '') return

  const dueDate = isValidISODate(dueDateInput.value) ? dueDateInput.value : null
  tasks.update(current.id, {
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
  emit('close')
}
</script>
