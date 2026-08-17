<template>
  <header class="shrink-0 border-b border-line px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">代辦事項</h1>
        <p class="mt-0.5 text-sm text-ink-faint">
          {{ remaining === 0 ? '目前沒有待辦的事' : `還有 ${remaining} 件事要做` }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button type="button" :aria-pressed="todoTaskStore.isSearch"
          :aria-label="todoTaskStore.isSearch ? '結束搜尋' : '搜尋代辦事項'"
          class="grid size-9 place-items-center rounded-md text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          :class="{ 'bg-accent-soft text-accent-ink': todoTaskStore.isSearch }"
          @click="toggleSearch">
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
            <path d="M10 2v1.6M10 16.4V18M18 10h-1.6M3.6 10H2M15.7 4.3l-1.1 1.1M5.4 14.6l-1.1 1.1M15.7 15.7l-1.1-1.1M5.4 5.4 4.3 4.3" />
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

    <!-- 輸入區：搜尋與新增共用同一個位置，避免版面在切換時跳動 -->
    <div class="mt-4 flex items-center gap-2">
      <label v-if="todoTaskStore.todoList.length > 0"
        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sunken"
        :title="isAll ? '全部取消完成' : '全部標記為完成'">
        <input v-model="isAll" type="checkbox" aria-label="全部標記為已完成"
          class="size-4.5 cursor-pointer accent-accent">
      </label>

      <div class="relative flex min-w-0 grow items-center gap-2">
        <template v-if="!todoTaskStore.isSearch">
          <input v-model.trim="task" aria-label="新增代辦事項" placeholder="要做什麼？" enterkeyhint="done"
            class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none"
            @keyup.enter="addTask">
          <button type="button" aria-label="新增"
            class="grid h-10 shrink-0 place-items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="task === ''" @click="addTask">
            新增
          </button>
        </template>

        <input v-else v-model.trim="todoTaskStore.keyword" aria-label="搜尋代辦事項" type="search"
          placeholder="搜尋…" enterkeyhint="search"
          class="h-10 min-w-0 grow rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none">
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { useTheme } from '@/composables/useTheme'

const todoTaskStore = useTodoTaskStore()
const { preference, cycle } = useTheme()

const themeLabel = computed(
  () =>
    ({
      light: '主題：淺色，點擊切換為深色',
      dark: '主題：深色，點擊切換為跟隨系統',
      system: '主題：跟隨系統，點擊切換為淺色',
    })[preference.value],
)

const remaining = computed(() => todoTaskStore.todoList.filter((t) => !t.isCompleted).length)

const task = ref('')
const addTask = () => {
  if (task.value === '') {
    return alert('請輸入代辦事項')
  }
  todoTaskStore.addTask(task.value)
  task.value = ''
}

const isAll = computed({
  get: () =>
    // 稽核 P13：空陣列的 every() 會回傳 true，全選框會顯示為已勾選。
    todoTaskStore.todoList.length > 0 && todoTaskStore.todoList.every((item) => item.isCompleted),
  set: (newValue: boolean) => {
    todoTaskStore.setAllCompleted(newValue)
  },
})

const toggleSearch = () => {
  todoTaskStore.isSearch = !todoTaskStore.isSearch
  todoTaskStore.keyword = ''
  task.value = ''
}
</script>
