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

    <!--
      指派給：跟留言／活動記錄一樣只有已設定同步且已登入時才有意義——
      純本機模式下沒有「別人」可以指派。選項來自 workspace.members，
      跟留言 @提及／活動記錄的作者名稱同一份資料來源。
    -->
    <label v-if="isSyncConfigured && auth.status === 'signed-in'"
      class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
      指派給
      <select v-model="assigneeInput"
        class="h-9 rounded-lg border border-line bg-surface px-2.5 text-[15px] font-normal text-ink focus:border-accent focus:outline-none">
        <option value="">未指派</option>
        <option v-for="m in workspace.members" :key="m.user_id" :value="m.user_id">
          {{ m.profiles?.display_name || '（未命名）' }}
        </option>
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
      <p v-if="collections.visibleTags.length === 0" class="mb-2 text-sm text-ink-faint">尚未建立任何標籤</p>
      <label v-for="tag in collections.visibleTags" :key="tag.id"
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

    <!--
      活動記錄跟留言一樣只有已設定同步且已登入時才有意義（都是伺服器端
      的概念）；活動記錄放在留言上面，讓「發生過什麼」先於「討論了什麼」。
    -->
    <template v-if="isSyncConfigured && auth.status === 'signed-in'">
      <TaskActivity :task-id="draft.id" />
      <TaskAttachments :task-id="draft.id" />
      <TaskComments :task-id="draft.id" />
    </template>

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
import { useAuthStore } from '@/stores/auth'
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
import { isSyncConfigured } from '@/sync/config'
import { useWorkspaceStore } from '@/stores/workspace'
import TaskComments from './TaskComments.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'

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
const auth = useAuthStore()
const workspace = useWorkspaceStore()

const draft = ref<StoredTask | null>(null)
const dueDateInput = ref('')
const dueTimeInput = ref('')
const projectInput = ref('')
const assigneeInput = ref('')
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
    assigneeInput.value = task.assigneeId ?? ''
  },
  { immediate: true },
)

/**
 * 同名（忽略大小寫／全形半形）就擋掉建立，而不是靜默重用——
 * 這裡上面已經有下拉選單／核取方塊可以直接選到既有項目，
 * 讓「建立」按鈕對一個已存在的名字生效只會讓人以為自己多建了一個。
 */
const projectNameError = computed(() =>
  // 用 projectsInCurrentWorkspace：理由同 CollectionsDialog.vue 的
  // projectNameError——跟收件匣同名要擋，但別的工作區同名不算。
  newProjectName.value !== '' &&
  findByNormalizedName(collections.projectsInCurrentWorkspace, newProjectName.value)
    ? '已有相同名稱的專案，請從上方選單選取'
    : null,
)

const tagNameError = computed(() =>
  newTagName.value !== '' && findByNormalizedName(collections.visibleTags, newTagName.value)
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
  const nextProjectId = projectInput.value === '' ? null : projectInput.value
  tasks.update(current.id, {
    taskName: current.taskName.trim(),
    notes: current.notes,
    priority: current.priority,
    dueDate,
    // 沒有日期的時間沒有意義
    dueTime: dueDate !== null && isValidTime(dueTimeInput.value) ? dueTimeInput.value : null,
    projectId: nextProjectId,
    // 換了專案的話，原本的區段（看板欄）一定屬於舊專案，繼續留著會被
    // 伺服器端的 validate_task_section 擋下——搬專案視同「移出看板」，
    // 沒換專案則保留原本的區段不動（這裡不提供改區段的欄位，那是看板
    // 拖曳的事）。
    sectionId: nextProjectId === current.projectId ? current.sectionId : null,
    tagIds: current.tagIds,
    recurrence: current.recurrence,
    // 欄位隱藏時（沒開同步／沒登入）assigneeInput 不會反映 draft 真正的
    // 值，直接送出去會把既有的指派靜默清掉——只有欄位顯示、使用者真的
    // 有機會改過它時才採用 assigneeInput，否則原封不動送回目前的值。
    assigneeId:
      isSyncConfigured && auth.status === 'signed-in'
        ? assigneeInput.value === '' ? null : assigneeInput.value
        : current.assigneeId,
  })
  emit('close')
}
</script>
