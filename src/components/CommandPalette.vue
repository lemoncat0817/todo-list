<template>
  <dialog ref="dialogEl"
    class="m-auto mt-[10vh] w-[min(92vw,34rem)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    aria-label="命令面板" @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col">
      <input ref="inputEl" v-model="query" type="text" role="combobox" aria-expanded="true"
        aria-controls="palette-results" :aria-activedescendant="activeId" aria-label="搜尋指令或任務"
        placeholder="輸入指令、檢視或任務名稱…" autocomplete="off"
        class="h-12 border-b border-line bg-surface px-4 text-base text-ink placeholder:text-ink-faint focus:outline-none"
        @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="run(results[cursor])">

      <ul v-if="results.length > 0" id="palette-results" role="listbox" aria-label="結果"
        class="max-h-[50vh] overflow-y-auto py-1">
        <!--
          option 本身就是可互動角色，裡面不能再包一顆 button——巢狀的互動元素
          會讓輔助科技看到兩個控制項（axe: nested-interactive）。
          鍵盤操作由上面那個 combobox 承擔（方向鍵移動、Enter 執行，位置以
          aria-activedescendant 告知），這正是 ARIA 的 combobox 標準分工：
          焦點全程留在輸入框，option 不該可聚焦、也不需要自己的按鍵處理。
          兩條 lint 規則都是針對「獨立的互動元素」而設，看不出這個分工。
        -->
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
        <li v-for="(item, index) in results" :id="`palette-item-${index}`" :key="item.key"
          role="option" :aria-selected="index === cursor"
          class="flex cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors"
          :class="index === cursor ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-sunken'"
          @click="run(item)" @mousemove="cursor = index">
          <span class="w-14 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-soft">
            {{ item.group }}
          </span>
          <span class="min-w-0 grow truncate text-sm">{{ item.label }}</span>
          <span v-if="item.hint" class="shrink-0 text-xs text-ink-soft">{{ item.hint }}</span>
        </li>
      </ul>

      <p v-else class="px-4 py-6 text-center text-sm text-ink-faint">找不到「{{ query }}」</p>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FIXED_VIEWS } from '@/router'
import { normalizeForSearch } from '@/domain/filtering'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useUiStore } from '@/stores/ui'
import { useTheme } from '@/composables/useTheme'

/**
 * 命令面板。
 *
 * 存在的理由不是「別的工具也有」，而是：檢視一多，側邊欄就開始需要捲動，
 * 而「跳到某個專案」變成一件要先用眼睛找的事。打字永遠比找快。
 *
 * 一併把跳轉與動作放進同一個清單，使用者不必先決定「這是導覽還是操作」——
 * 那是實作的分類，不是使用者腦中的分類。
 *
 * 手寫而非引元件庫：一個 combobox + listbox 的鍵盤行為約八十行，
 * 而既有註解已經算過，光一個 Dialog 元件就要 +26 kB gzip。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const tasks = useTasksStore()
const collections = useCollectionsStore()
const ui = useUiStore()
const { cycle } = useTheme()

interface Command {
  key: string
  group: string
  label: string
  hint?: string
  run: () => void
}

const dialogEl = ref<HTMLDialogElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const query = ref('')
const cursor = ref(0)

const commands = computed<Command[]>(() => {
  const list: Command[] = []

  for (const view of FIXED_VIEWS) {
    list.push({
      key: `view:${view.kind}`,
      group: '前往',
      label: view.label,
      run: () => void router.push(view.path),
    })
  }

  for (const project of collections.projects) {
    list.push({
      key: `project:${project.id}`,
      group: '專案',
      label: project.name,
      run: () => void router.push(`/project/${project.id}`),
    })
  }

  for (const tag of collections.tags) {
    list.push({
      key: `tag:${tag.id}`,
      group: '標籤',
      label: `#${tag.name}`,
      run: () => void router.push(`/label/${tag.id}`),
    })
  }

  for (const filter of collections.filters) {
    list.push({
      key: `filter:${filter.id}`,
      group: '篩選器',
      label: filter.name,
      hint: filter.query,
      run: () => void router.push({ path: '/filter', query: { q: filter.query } }),
    })
  }

  list.push(
    {
      key: 'action:clear-completed',
      group: '動作',
      label: '清除已完成的代辦事項',
      run: () => tasks.clearCompleted(),
    },
    { key: 'action:theme', group: '動作', label: '切換主題', run: () => cycle() },
    {
      key: 'action:search',
      group: '動作',
      label: '搜尋代辦事項',
      hint: '/',
      run: () => {
        ui.isSearch = true
      },
    },
  )

  // 任務排在最後：打字時多半是想跳到某個檢視，任務通常用搜尋找
  for (const task of tasks.items) {
    list.push({
      key: `task:${task.id}`,
      group: '任務',
      label: task.taskName,
      run: () => ui.openDetail(task.id),
    })
  }

  return list
})

const results = computed(() => {
  const needle = normalizeForSearch(query.value.trim())
  const matched =
    needle === ''
      ? commands.value.filter((c) => c.group !== '任務')
      : commands.value.filter((c) => normalizeForSearch(c.label).includes(needle))
  // 沒有上限的話，幾百筆任務會讓面板變成另一份清單
  return matched.slice(0, 30)
})

const activeId = computed(() =>
  results.value.length > 0 ? `palette-item-${cursor.value}` : undefined,
)

watch(query, () => {
  cursor.value = 0
})

watch(
  () => props.open,
  async (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open) {
      query.value = ''
      cursor.value = 0
      if (!el.open) el.showModal()
      await nextTick()
      inputEl.value?.focus()
    } else if (el.open) {
      el.close()
    }
  },
)

function move(delta: 1 | -1): void {
  const total = results.value.length
  if (total === 0) return
  // 兩端循環：長清單的最後一項用「往上」一步就能到
  cursor.value = (cursor.value + delta + total) % total
}

function run(command: Command | undefined): void {
  if (!command) return
  command.run()
  emit('close')
}
</script>
