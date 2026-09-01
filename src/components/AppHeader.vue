<template>
  <header class="shrink-0 border-b border-line px-4 pt-4 pb-3 sm:px-6">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <button v-if="!isDesktop" type="button" aria-label="開啟導覽"
          class="grid size-9 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="ui.openSidebar()">
          <svg viewBox="0 0 20 20" class="size-5" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.7" stroke-linecap="round">
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          </svg>
        </button>

        <div class="min-w-0">
          <h1 class="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">{{ title }}</h1>
          <p class="mt-0.5 text-sm text-ink-faint">
            {{ tasks.remaining === 0 ? '目前沒有待辦的事' : `還有 ${tasks.remaining} 件事要做` }}
          </p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button v-if="isTaskView" type="button" :aria-pressed="ui.isSearch"
          :aria-label="ui.isSearch ? '結束搜尋' : '搜尋代辦事項'"
          class="grid size-9 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          :class="{ 'bg-accent-soft text-accent-ink': ui.isSearch }" @click="ui.toggleSearch()">
          <svg viewBox="0 0 20 20" class="size-5" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.7" stroke-linecap="round">
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.2 13.2 3.3 3.3" />
          </svg>
        </button>

        <button type="button" :aria-label="themeLabel"
          class="grid size-9 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="cycle">
          <svg v-if="preference === 'light'" viewBox="0 0 20 20" class="size-5" aria-hidden="true"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="10" cy="10" r="3.6" />
            <path
              d="M10 2v1.6M10 16.4V18M18 10h-1.6M3.6 10H2M15.7 4.3l-1.1 1.1M5.4 14.6l-1.1 1.1M15.7 15.7l-1.1-1.1M5.4 5.4 4.3 4.3" />
          </svg>
          <svg v-else-if="preference === 'dark'" viewBox="0 0 20 20" class="size-5" aria-hidden="true"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
            <path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z" />
          </svg>
          <svg v-else viewBox="0 0 20 20" class="size-5" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
            <rect x="2.5" y="4" width="15" height="10" rx="1.6" />
            <path d="M7 17h6" />
          </svg>
        </button>
      </div>
    </div>

    <!--
      新增列一律可見——搜尋不再頂掉它。之前搜尋與新增共用同一個位置，
      切換到搜尋後新增輸入框會整個消失，使用者得先手動關掉搜尋才能補一筆待辦。
      「全部標記為完成」只在非搜尋狀態顯示：它作用在全部任務上，不是眼前這幾筆
      篩選結果，搜尋中放在一起容易讓人誤以為是「全選搜尋結果」。
    -->
    <div v-if="isTaskView" class="mt-4 flex items-center gap-2">
      <label v-if="tasks.items.length > 0 && !ui.isSearch"
        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sunken"
        :title="allCompleted ? '全部取消完成' : '全部標記為完成'">
        <input v-model="allCompleted" type="checkbox" aria-label="全部標記為已完成"
          class="size-4.5 cursor-pointer accent-accent">
      </label>

      <div class="flex min-w-0 grow items-center gap-2">
        <input v-model.trim="draft" aria-label="新增代辦事項" :placeholder="placeholder" enterkeyhint="done"
          aria-describedby="quick-add-hint"
          class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none"
          @focus="focused = true" @blur="focused = false" @keyup.enter="submit">
        <button type="button" aria-label="新增"
          class="grid h-10 shrink-0 place-items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          :disabled="draft === ''" @click="submit">
          新增
        </button>
      </div>
    </div>

    <!--
      解析預覽：系統把哪些片段理解成什麼，必須在送出前就看得到。
      少了這一塊，快速新增就是在賭——猜錯的代價是事後再開一次詳情補救，
      等於把省下來的步驟又還回去。
    -->
    <p v-if="isTaskView && tokens.length > 0" class="mt-2 flex flex-wrap items-center gap-1.5" role="status"
      aria-live="polite">
      <span class="text-[12px] text-ink-faint">將建立：</span>
      <span class="rounded bg-sunken px-1.5 py-0.5 text-[12px] font-medium text-ink">
        {{ parsed.taskName }}
      </span>
      <span v-for="(token, i) in tokens" :key="i"
        class="rounded bg-accent-soft px-1.5 py-0.5 text-[12px] font-medium text-accent-ink">
        {{ token.label }}
      </span>
    </p>

    <p v-else-if="isTaskView && focused" id="quick-add-hint" class="mt-2 text-[12px] text-ink-faint">
      可以直接打：明天 / 下午3點 / 每週一 / p1 / #專案 / @標籤
    </p>

    <!-- 搜尋列：獨立在新增列下方，只在開啟搜尋時出現，關閉時完全不佔位置 -->
    <div v-if="isTaskView && ui.isSearch" class="mt-2 flex items-center gap-2">
      <input v-model.trim="ui.keyword" aria-label="搜尋代辦事項" type="search" placeholder="搜尋…" enterkeyhint="search"
        class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none">
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useCollectionsStore } from '@/stores/collections'
import { parseQuickAdd } from '@/domain/quickAdd'
import { useTheme } from '@/composables/useTheme'
import { useCurrentView } from '@/composables/useCurrentView'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { today } from '@/domain/dates'
import type { StoredTask } from '@/db/schema'

const tasks = useTasksStore()
const ui = useUiStore()
const collections = useCollectionsStore()
const { preference, cycle } = useTheme()
const { spec, title } = useCurrentView()
const route = useRoute()
const isDesktop = useMediaQuery('(min-width: 1024px)')

const themeLabel = computed(
  () =>
    ({
      light: '主題：淺色，點擊切換為深色',
      dark: '主題：深色，點擊切換為跟隨系統',
      system: '主題：跟隨系統，點擊切換為淺色',
    })[preference.value],
)

const draft = ref('')
const focused = ref(false)

/** 統計頁沒有清單，新增與搜尋在那裡沒有作用對象，一併收起來。 */
const isTaskView = computed(() => route.name !== 'stats')

/**
 * 快速新增的解析結果。
 *
 * 每次輸入都重新解析是刻意的：parseQuickAdd 是純函式、沒有 IO，
 * 成本遠低於「使用者送出後才發現猜錯」的代價。
 */
const parsed = computed(() =>
  parseQuickAdd(draft.value, { projects: collections.projects, tags: collections.tags }),
)
const tokens = computed(() => parsed.value.tokens)

/**
 * 新增時繼承目前檢視的脈絡。
 *
 * 在「工作」專案底下新增，理所當然屬於「工作」；在「今天」底下新增，
 * 理所當然是今天要做的。少了這一步，使用者每加一筆都得再開一次詳情去補分類——
 * 那正是原本最花時間的地方。
 */
const contextOverrides = computed<Partial<StoredTask>>(() => {
  switch (spec.value.kind) {
    case 'today':
      return { dueDate: today() }
    case 'project':
      return spec.value.id === null ? {} : { projectId: spec.value.id }
    case 'label':
      return spec.value.id === null ? {} : { tagIds: [spec.value.id] }
    default:
      return {}
  }
})

const placeholder = computed(() =>
  spec.value.kind === 'today' ? '今天要做什麼？' : '要做什麼？',
)

/**
 * 空值時按鈕停用，不用 alert 事後責備使用者。
 *
 * 解析結果覆蓋檢視脈絡：使用者明確打出「明天」時，那個意圖比
 * 「你正站在今天這個檢視」更強。沒解析到的欄位才落回脈絡預設。
 */
function submit(): void {
  if (draft.value === '') return
  const result = parsed.value
  const f = result.fields
  const fields: Partial<StoredTask> = { ...contextOverrides.value }

  if (f.dueDate !== null) {
    fields.dueDate = f.dueDate
    fields.dueTime = f.dueTime
  }
  if (f.priority !== 0) fields.priority = f.priority
  if (f.recurrence !== null) fields.recurrence = f.recurrence

  // 打了 #名稱 但還沒有這個專案就順手建立：預覽已經標示「新專案」，
  // 使用者送出前就知道會多出一個，不算偷偷做事。
  if (f.projectId !== null) fields.projectId = f.projectId
  else if (result.unknownProject !== null) {
    fields.projectId = collections.addProject(result.unknownProject).id
  }

  const tagIds = [
    ...(fields.tagIds ?? []),
    ...f.tagIds,
    ...result.unknownTags.map((name) => collections.addTag(name).id),
  ]
  if (tagIds.length > 0) fields.tagIds = [...new Set(tagIds)]

  tasks.add(result.taskName, fields)
  draft.value = ''
}

const allCompleted = computed({
  // 稽核 P13：[].every() 依規範回傳 true，空清單會顯示為全部完成，
  // 因此必須額外檢查長度。
  get: () => tasks.items.length > 0 && tasks.items.every((item) => item.isCompleted),
  set: (value: boolean) => tasks.setAllCompleted(value),
})
</script>
