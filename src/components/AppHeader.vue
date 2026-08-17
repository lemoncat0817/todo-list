<template>
  <header class="shrink-0 border-b border-line px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">代辦事項</h1>
        <p class="mt-0.5 text-sm text-ink-faint">
          {{ tasks.remaining === 0 ? '目前沒有待辦的事' : `還有 ${tasks.remaining} 件事要做` }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button type="button" :aria-pressed="ui.isSearch"
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

    <!-- 搜尋與新增共用同一個位置，避免切換時版面跳動 -->
    <div class="mt-4 flex items-center gap-2">
      <label v-if="tasks.items.length > 0"
        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sunken"
        :title="allCompleted ? '全部取消完成' : '全部標記為完成'">
        <input v-model="allCompleted" type="checkbox" aria-label="全部標記為已完成"
          class="size-4.5 cursor-pointer accent-accent">
      </label>

      <div class="relative flex min-w-0 grow items-center gap-2">
        <template v-if="!ui.isSearch">
          <input v-model.trim="draft" aria-label="新增代辦事項" placeholder="要做什麼？" enterkeyhint="done"
            class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none"
            @keyup.enter="submit">
          <button type="button" aria-label="新增"
            class="grid h-10 shrink-0 place-items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="draft === ''" @click="submit">
            新增
          </button>
        </template>

        <input v-else v-model.trim="ui.keyword" aria-label="搜尋代辦事項" type="search" placeholder="搜尋…"
          enterkeyhint="search"
          class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none">
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/useTheme'

const tasks = useTasksStore()
const ui = useUiStore()
const { preference, cycle } = useTheme()

const themeLabel = computed(
  () =>
    ({
      light: '主題：淺色，點擊切換為深色',
      dark: '主題：深色，點擊切換為跟隨系統',
      system: '主題：跟隨系統，點擊切換為淺色',
    })[preference.value],
)

const draft = ref('')

/** 空值時按鈕停用，不用 alert 事後責備使用者。 */
function submit(): void {
  if (draft.value === '') return
  tasks.add(draft.value)
  draft.value = ''
}

const allCompleted = computed({
  // 稽核 P13：[].every() 依規範回傳 true，空清單會顯示為全部完成，
  // 因此必須額外檢查長度。
  get: () => tasks.items.length > 0 && tasks.items.every((item) => item.isCompleted),
  set: (value: boolean) => tasks.setAllCompleted(value),
})
</script>
