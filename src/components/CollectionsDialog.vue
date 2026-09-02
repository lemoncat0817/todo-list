<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,34rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-5 p-5">
      <h2 class="text-lg font-semibold tracking-tight">管理專案與標籤</h2>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">專案</h3>

        <p v-if="collections.visibleProjects.length === 0" class="text-sm text-ink-faint">
          還沒有專案。專案用來把任務分成幾個大方向，標籤則適合跨專案的情境。
        </p>

        <ul v-else class="flex flex-col gap-1.5">
          <li v-for="project in collections.visibleProjects" :key="project.id"
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
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-ink-faint">快速填入：</span>
            <button v-for="preset in FILTER_QUERY_PRESETS" :key="preset.query" type="button"
              class="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent-ink"
              @click="applyFilterPreset(preset)">
              {{ preset.label }}
            </button>
          </div>

          <div class="flex gap-2">
            <label class="sr-only" for="new-filter-name">篩選器名稱</label>
            <input id="new-filter-name" v-model.trim="newFilterName" placeholder="名稱，例如「今天的要事」"
              class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          </div>
          <div class="relative flex gap-2">
            <label class="sr-only" for="new-filter-query">篩選條件</label>
            <input id="new-filter-query" ref="queryInputEl" v-model.trim="newFilterQuery" type="text"
              role="combobox" aria-autocomplete="list" :aria-expanded="showSuggestions"
              aria-controls="filter-query-suggestions"
              :aria-activedescendant="activeSuggestion >= 0 ? `filter-suggestion-${activeSuggestion}` : undefined"
              placeholder="today &amp; p1" autocomplete="off"
              class="h-9 min-w-0 grow rounded-lg border bg-surface px-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              :class="queryError === null ? 'border-line focus:border-accent' : 'border-danger'"
              @input="syncQueryCursor" @click="syncQueryCursor" @keyup="syncQueryCursor"
              @focus="suggestionsOpen = true" @blur="suggestionsOpen = false" @keydown="onQueryKeydown">
            <button type="button"
              class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              :disabled="!canCreateFilter" @click="createFilter">
              建立
            </button>

            <!--
              option 不能自己拿焦點——焦點全程留在輸入框，方向鍵移動、Enter 接受，
              位置由 aria-activedescendant 告知，跟 CommandPalette 是同一套 combobox 分工。
              @mousedown.prevent 是關鍵：沒有它，滑鼠按下去輸入框會先 blur、
              清單在 click 事件觸發前就被 v-if 拿掉，等於點不到。
            -->
            <ul v-if="showSuggestions" id="filter-query-suggestions" role="listbox" aria-label="篩選語法建議"
              class="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-md">
              <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
              <li v-for="(item, index) in suggestions" :id="`filter-suggestion-${index}`"
                :key="`${item.kind}:${item.label}`" role="option" :aria-selected="index === activeSuggestion"
                class="flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm"
                :class="index === activeSuggestion ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-sunken'"
                @mousedown.prevent="acceptSuggestion(index)" @mousemove="activeSuggestion = index">
                <span class="truncate font-mono">{{ item.label }}</span>
                <span v-if="item.hint" class="shrink-0 text-xs text-ink-soft">{{ item.hint }}</span>
              </li>
            </ul>
          </div>

          <!-- 先說結果再說語法：使用者要的是「這個條件對不對」，不是規格書 -->
          <p v-if="queryError !== null" role="alert" class="text-sm text-danger-ink">
            {{ queryError }}
          </p>
          <template v-else>
            <p v-if="newFilterQuery !== ''" class="text-sm text-ink-soft">
              目前符合 {{ matchCount }} 項
            </p>
            <p v-if="unresolvedMessage !== null" class="text-sm text-warning-ink">
              {{ unresolvedMessage }}
            </p>
          </template>
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
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { COLLECTION_COLORS } from '@/db/schema'
import { useCollectionsStore } from '@/stores/collections'
import { useTasksStore } from '@/stores/tasks'
import { useRoute, useRouter } from 'vue-router'
import {
  FILTER_QUERY_PRESETS,
  findUnresolvedNames,
  parseFilterQuery,
  suggestFilterTokens,
} from '@/domain/filterQuery'
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
const queryInputEl = useTemplateRef<HTMLInputElement>('queryInputEl')
const newProjectName = ref('')
const newTagName = ref('')
const newFilterName = ref('')
const newFilterQuery = ref('')
const queryCursor = ref(0)
const activeSuggestion = ref(-1)
const suggestionsOpen = ref(false)

/**
 * 建立前先擋掉同名（忽略大小寫／全形半形）——store 的 addProject/addTag
 * 雖然也會擋，但那裡是靜默重用既有項目；使用者按了「建立」卻什麼都沒發生，
 * 不說明原因會誤以為是壞掉了。
 */
const projectNameError = computed(() =>
  // 用未過濾的 projects：跟收件匣同名一樣要擋，理由見上方註解——
  // store 那道防線比對的也是全量，這裡要跟它認定一致，不能只比對看得到的。
  newProjectName.value !== '' && findByNormalizedName(collections.projects, newProjectName.value)
    ? '已有相同名稱的專案'
    : null,
)

const tagNameError = computed(() =>
  newTagName.value !== '' && findByNormalizedName(collections.tags, newTagName.value)
    ? '已有相同名稱的標籤'
    : null,
)

/** 只解析一次，錯誤訊息、符合筆數、未知名稱檢查都share這個結果。 */
const parsedQuery = computed(() => parseFilterQuery(newFilterQuery.value))

/** 建立前就先告訴使用者條件對不對、會match 幾項——存下一個永遠是空的篩選器沒有意義。 */
const queryError = computed(() => {
  if (newFilterQuery.value === '') return null
  const parsed = parsedQuery.value
  return parsed.ok ? null : parsed.message
})

const matchCount = computed(() =>
  queryError.value === null && newFilterQuery.value !== ''
    ? tasks.countOf({ kind: 'filter', id: newFilterQuery.value })
    : 0,
)

/**
 * 語法沒錯，但 #專案／@標籤 指到目前不存在的名稱——這時「符合 0 項」
 * 會讓人以為是自己沒有符合條件的任務，而不是打錯了名字，兩者要分開講。
 * 不擋建立：也可能是提前為了一個還沒建的專案先寫好篩選器。
 */
const unresolvedNames = computed(() => {
  const parsed = parsedQuery.value
  if (!parsed.ok) return { projects: [], labels: [] }
  return findUnresolvedNames(parsed.node, { projects: collections.visibleProjects, tags: collections.tags })
})

const unresolvedMessage = computed(() => {
  const { projects, labels } = unresolvedNames.value
  if (projects.length === 0 && labels.length === 0) return null
  const parts = [
    ...projects.map((name) => `專案「${name}」`),
    ...labels.map((name) => `標籤「${name}」`),
  ]
  return `目前沒有${parts.join('、')}，這部分的條件不會比對到任何任務`
})

const canCreateFilter = computed(
  () => newFilterName.value !== '' && newFilterQuery.value !== '' && queryError.value === null,
)

/** 游標所在那個詞的自動完成建議；輸入框沒開啟建議清單時不用算。 */
const suggestionResult = computed(() =>
  suggestionsOpen.value
    ? suggestFilterTokens(newFilterQuery.value, queryCursor.value, {
        projects: collections.visibleProjects,
        tags: collections.tags,
      })
    : { range: { start: 0, end: 0 }, suggestions: [] },
)
const suggestions = computed(() => suggestionResult.value.suggestions)
const showSuggestions = computed(() => suggestionsOpen.value && suggestions.value.length > 0)

/** 輸入內容一變，先前選到的建議項目大多已經不對應了。 */
watch(newFilterQuery, () => {
  activeSuggestion.value = -1
})

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
      collections.visibleProjects.find((p) => p.id === id)?.name ?? ''
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
  suggestionsOpen.value = false
}

/** 每次游標可能移動的事件都同步一次位置——建議清單是算給「這個詞」看的，不是算給整串字看的。 */
function syncQueryCursor(event: Event): void {
  queryCursor.value = (event.target as HTMLInputElement).selectionStart ?? newFilterQuery.value.length
}

function acceptSuggestion(index: number): void {
  const suggestion = suggestions.value[index]
  if (!suggestion) return
  const { range } = suggestionResult.value
  const before = newFilterQuery.value.slice(0, range.start)
  const after = newFilterQuery.value.slice(range.end)
  // 插入後補一個空白，游標落在空白後面才能直接接著打下一個詞或運算子
  const insertion = suggestion.insertText + (/^\s/.test(after) ? '' : ' ')
  newFilterQuery.value = before + insertion + after
  const nextCursor = before.length + insertion.length
  activeSuggestion.value = -1
  void nextTick(() => {
    const el = queryInputEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(nextCursor, nextCursor)
    queryCursor.value = nextCursor
  })
}

function applyFilterPreset(preset: { label: string; query: string }): void {
  newFilterQuery.value = preset.query
  if (newFilterName.value === '') newFilterName.value = preset.label
  void nextTick(() => {
    const el = queryInputEl.value
    if (!el) return
    // focus() 會同步觸發 @focus 把 suggestionsOpen 打開，所以要放在最後一行蓋回去——
    // 剛套用範本不需要馬上跳出建議清單，游標落在句尾讓使用者可以直接接著打字。
    el.focus()
    el.setSelectionRange(preset.query.length, preset.query.length)
    queryCursor.value = preset.query.length
    suggestionsOpen.value = false
  })
}

/**
 * Enter／方向鍵在「操作建議清單」和「打字」之間是同一顆鍵的兩種意思，
 * 用 showSuggestions 分流：清單開著時先服務清單，沒有選到建議才落回原本的
 * 建立篩選器行為，跟名稱／標籤輸入框的 @keydown.enter.prevent 一致。
 */
function onQueryKeydown(event: KeyboardEvent): void {
  if (showSuggestions.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeSuggestion.value = (activeSuggestion.value + 1 + suggestions.value.length) % suggestions.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeSuggestion.value =
        (activeSuggestion.value - 1 + suggestions.value.length) % suggestions.value.length
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && activeSuggestion.value >= 0) {
      event.preventDefault()
      acceptSuggestion(activeSuggestion.value)
      return
    }
    if (event.key === 'Escape') {
      // 只收合清單，不讓 Escape 繼續冒泡去關掉整個對話框
      event.preventDefault()
      event.stopPropagation()
      suggestionsOpen.value = false
      return
    }
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    createFilter()
  }
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
