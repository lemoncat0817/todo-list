<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,34rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-5 p-5">
      <h2 class="text-lg font-semibold tracking-tight">管理專案與標籤</h2>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">專案</h3>

        <p v-if="collections.projects.length === 0" class="text-sm text-ink-faint">
          還沒有專案。專案用來把任務分成幾個大方向，標籤則適合跨專案的情境。
        </p>

        <ul v-else class="flex flex-col gap-1.5">
          <li v-for="project in collections.projects" :key="project.id"
            class="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: project.color }"
              aria-hidden="true" />
            <label class="sr-only" :for="`project-name-${project.id}`">專案名稱</label>
            <input :id="`project-name-${project.id}`" :value="project.name"
              class="h-8 min-w-0 grow rounded-md border border-transparent bg-transparent px-1.5 text-[15px] text-ink hover:border-line focus:border-accent focus:outline-none"
              @change="renameProject(project.id, $event)">

            <label class="sr-only" :for="`project-color-${project.id}`">專案顏色</label>
            <select :id="`project-color-${project.id}`" :value="project.color"
              class="h-8 shrink-0 rounded-md border border-line bg-surface px-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              @change="recolorProject(project.id, $event)">
              <option v-for="c in COLLECTION_COLORS" :key="c.value" :value="c.value">{{ c.name }}</option>
            </select>

            <button type="button" :aria-label="`刪除專案「${project.name}」`"
              class="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
              @click="removeProject(project.id)">
              <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round">
                <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
              </svg>
            </button>
          </li>
        </ul>

        <p class="text-xs text-ink-faint">刪除專案時，底下的任務會移到未分類，不會跟著被刪除。</p>

        <div class="flex gap-2">
          <label class="sr-only" for="new-project">新專案名稱</label>
          <input id="new-project" v-model.trim="newProjectName" placeholder="新增專案…"
            :aria-invalid="projectNameError !== null"
            class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @keydown.enter.prevent="createProject">
          <button type="button"
            class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="newProjectName === '' || projectNameError !== null" @click="createProject">
            建立
          </button>
        </div>
        <p v-if="projectNameError" class="text-xs text-danger-ink">{{ projectNameError }}</p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">標籤</h3>

        <p v-if="collections.tags.length === 0" class="text-sm text-ink-faint">還沒有標籤。</p>

        <ul v-else class="flex flex-col gap-1.5">
          <li v-for="tag in collections.tags" :key="tag.id"
            class="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }"
              aria-hidden="true" />
            <label class="sr-only" :for="`tag-name-${tag.id}`">標籤名稱</label>
            <input :id="`tag-name-${tag.id}`" :value="tag.name"
              class="h-8 min-w-0 grow rounded-md border border-transparent bg-transparent px-1.5 text-[15px] text-ink hover:border-line focus:border-accent focus:outline-none"
              @change="renameTag(tag.id, $event)">

            <label class="sr-only" :for="`tag-color-${tag.id}`">標籤顏色</label>
            <select :id="`tag-color-${tag.id}`" :value="tag.color"
              class="h-8 shrink-0 rounded-md border border-line bg-surface px-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              @change="recolorTag(tag.id, $event)">
              <option v-for="c in COLLECTION_COLORS" :key="c.value" :value="c.value">{{ c.name }}</option>
            </select>

            <button type="button" :aria-label="`刪除標籤「${tag.name}」`"
              class="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
              @click="removeTag(tag.id)">
              <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round">
                <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
              </svg>
            </button>
          </li>
        </ul>

        <div class="flex gap-2">
          <label class="sr-only" for="new-tag">新標籤名稱</label>
          <input id="new-tag" v-model.trim="newTagName" placeholder="新增標籤…"
            :aria-invalid="tagNameError !== null"
            class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            @keydown.enter.prevent="createTag">
          <button type="button"
            class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="newTagName === '' || tagNameError !== null" @click="createTag">
            建立
          </button>
        </div>
        <p v-if="tagNameError" class="text-xs text-danger-ink">{{ tagNameError }}</p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">篩選器</h3>

        <ul v-if="collections.filters.length > 0" class="flex flex-col gap-1.5">
          <li v-for="filter in collections.filters" :key="filter.id"
            class="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: filter.color }"
              aria-hidden="true" />
            <div class="min-w-0 grow">
              <p class="truncate text-[15px] text-ink">{{ filter.name }}</p>
              <p class="truncate font-mono text-xs text-ink-soft">{{ filter.query }}</p>
            </div>
            <button type="button" :aria-label="`刪除篩選器「${filter.name}」`"
              class="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
              @click="removeFilter(filter.id)">
              <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
              </svg>
            </button>
          </li>
        </ul>

        <div class="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div class="flex gap-2">
            <label class="sr-only" for="new-filter-name">篩選器名稱</label>
            <input id="new-filter-name" v-model.trim="newFilterName" placeholder="名稱，例如「今天的要事」"
              class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          </div>
          <div class="flex gap-2">
            <label class="sr-only" for="new-filter-query">篩選條件</label>
            <input id="new-filter-query" v-model.trim="newFilterQuery" placeholder="today &amp; p1"
              class="h-9 min-w-0 grow rounded-lg border bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              :class="queryError === null ? 'border-line focus:border-accent' : 'border-danger'">
            <button type="button"
              class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              :disabled="!canCreateFilter" @click="createFilter">
              建立
            </button>
          </div>

          <!-- 先說結果再說語法：使用者要的是「這個條件對不對」，不是規格書 -->
          <p v-if="queryError !== null" role="alert" class="text-sm text-danger-ink">
            {{ queryError }}
          </p>
          <p v-else-if="newFilterQuery !== ''" class="text-sm text-ink-soft">
            目前符合 {{ matchCount }} 項
          </p>
          <p class="text-xs text-ink-faint">
            可用：<span class="font-mono">today</span>、<span class="font-mono">overdue</span>、
            <span class="font-mono">upcoming</span>、<span class="font-mono">nodate</span>、
            <span class="font-mono">done</span>、<span class="font-mono">p1</span>–<span
              class="font-mono">p4</span>、<span class="font-mono">#專案</span>、
            <span class="font-mono">@標籤</span>，以及 <span class="font-mono">&amp;</span>
            <span class="font-mono">|</span> <span class="font-mono">!</span>
            <span class="font-mono">( )</span>
          </p>
        </div>
      </section>

      <div class="flex justify-end">
        <button type="button"
          class="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('close')">
          關閉
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { COLLECTION_COLORS } from '@/db/schema'
import { useCollectionsStore } from '@/stores/collections'
import { useTasksStore } from '@/stores/tasks'
import { useRoute, useRouter } from 'vue-router'
import { parseFilterQuery } from '@/domain/filterQuery'
import { findByNormalizedName } from '@/domain/filtering'

/**
 * 專案與標籤的管理介面。
 *
 * 在此之前兩者只能在任務詳情裡「就地建立」，建完就再也改不了——
 * store 早就有可復原的刪除與更新，缺的一直只是入口。
 *
 * 刪除不跳確認對話框，與專案其他破壞性操作一致（稽核 P15/P16）：
 * 做完之後可復原，比先攔一次再讓人盲目按下「確定」有用。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const collections = useCollectionsStore()
const tasks = useTasksStore()
const route = useRoute()
const router = useRouter()

const dialogEl = useTemplateRef<HTMLDialogElement>('dialogEl')
const newProjectName = ref('')
const newTagName = ref('')
const newFilterName = ref('')
const newFilterQuery = ref('')

/**
 * 建立前先擋掉同名（忽略大小寫／全形半形）——store 的 addProject/addTag
 * 雖然也會擋，但那裡是靜默重用既有項目；使用者按了「建立」卻什麼都沒發生，
 * 不說明原因會誤以為是壞掉了。
 */
const projectNameError = computed(() =>
  newProjectName.value !== '' && findByNormalizedName(collections.projects, newProjectName.value)
    ? '已有相同名稱的專案'
    : null,
)

const tagNameError = computed(() =>
  newTagName.value !== '' && findByNormalizedName(collections.tags, newTagName.value)
    ? '已有相同名稱的標籤'
    : null,
)

/** 建立前就先告訴使用者條件對不對、會match 幾項——存下一個永遠是空的篩選器沒有意義。 */
const queryError = computed(() => {
  if (newFilterQuery.value === '') return null
  const parsed = parseFilterQuery(newFilterQuery.value)
  return parsed.ok ? null : parsed.message
})

const matchCount = computed(() =>
  queryError.value === null && newFilterQuery.value !== ''
    ? tasks.countOf({ kind: 'filter', id: newFilterQuery.value })
    : 0,
)

const canCreateFilter = computed(
  () => newFilterName.value !== '' && newFilterQuery.value !== '' && queryError.value === null,
)

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  },
)

function targetValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

function renameProject(id: string, event: Event): void {
  const name = targetValue(event).trim()
  // 空名字會讓側邊欄出現一個點不到的項目；直接忽略並還原顯示值
  if (name === '') {
    ;(event.target as HTMLInputElement).value =
      collections.projects.find((p) => p.id === id)?.name ?? ''
    return
  }
  collections.updateProject(id, { name })
}

function recolorProject(id: string, event: Event): void {
  collections.updateProject(id, { color: targetValue(event) })
}

function renameTag(id: string, event: Event): void {
  const name = targetValue(event).trim()
  if (name === '') {
    ;(event.target as HTMLInputElement).value = collections.tags.find((t) => t.id === id)?.name ?? ''
    return
  }
  collections.updateTag(id, { name })
}

function recolorTag(id: string, event: Event): void {
  collections.updateTag(id, { color: targetValue(event) })
}

/** 刪掉正在看的那個專案／標籤時要離開它的檢視，否則會停在一個指向不存在項目的網址。 */
function removeProject(id: string): void {
  tasks.removeProject(id)
  if (route.name === 'project' && route.params.id === id) void router.push('/today')
}

function removeTag(id: string): void {
  tasks.removeTag(id)
  if (route.name === 'label' && route.params.id === id) void router.push('/today')
}

function createProject(): void {
  if (newProjectName.value === '' || projectNameError.value) return
  collections.addProject(newProjectName.value)
  newProjectName.value = ''
}

function createTag(): void {
  if (newTagName.value === '' || tagNameError.value) return
  collections.addTag(newTagName.value)
  newTagName.value = ''
}

function createFilter(): void {
  if (!canCreateFilter.value) return
  collections.addFilter(newFilterName.value, newFilterQuery.value)
  newFilterName.value = ''
  newFilterQuery.value = ''
}

/** 刪掉正在看的那個篩選器時要離開它的檢視。 */
function removeFilter(id: string): void {
  const filter = collections.filters.find((f) => f.id === id)
  collections.removeFilter(id)
  if (route.name === 'filter' && filter && route.query.q === filter.query) {
    void router.push('/today')
  }
}
</script>
