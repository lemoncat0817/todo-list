<template>
  <div class="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3 sm:px-6">
    <label class="sr-only" for="sort-by">排序方式</label>
    <select id="sort-by" :value="prefs.sortBy" :class="selectClass"
      @change="prefs.setSort(($event.target as HTMLSelectElement).value as SortKey)">
      <option v-for="(label, key) in SORT_LABELS" :key="key" :value="key">排序：{{ label }}</option>
    </select>

    <!-- 今天／即將到來本來就以日期為軸分組，再疊一層分組只會互相打架 -->
    <template v-if="!isDateView">
      <label class="sr-only" for="group-by">分組方式</label>
      <select id="group-by" :value="prefs.groupBy" :class="selectClass"
        @change="prefs.setGroupBy(($event.target as HTMLSelectElement).value as GroupKey)">
        <option v-for="(label, key) in GROUP_LABELS" :key="key" :value="key">分組：{{ label }}</option>
      </select>
    </template>

    <button v-if="viewKind === 'filter' && query" type="button"
      class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink transition-colors hover:bg-sunken"
      @click="save">
      儲存此篩選器
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  GROUP_LABELS,
  SORT_LABELS,
  type GroupKey,
  type SortKey,
  type ViewKind,
} from '@/domain/views'
import { usePrefsStore } from '@/stores/prefs'
import { useCollectionsStore } from '@/stores/collections'

/**
 * 排序與分組的控制列。
 *
 * 選擇存在 prefs（會被記住）而不是網址：它是「我習慣怎麼看」，
 * 不是「我現在在看什麼」。後者才屬於網址——分享一個連結給別人時，
 * 對方應該看到同一份清單，而不是被強加你的排序習慣。
 */
const props = defineProps<{ viewKind: ViewKind; query: string | null }>()

const prefs = usePrefsStore()
const collections = useCollectionsStore()
const router = useRouter()

const selectClass =
  'h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink transition-colors hover:bg-sunken focus:border-accent focus:outline-none'

const isDateView = computed(
  () => props.viewKind === 'today' || props.viewKind === 'upcoming',
)

/** 用查詢字串本身當預設名稱：多數人存下來之後才會想到要改名。 */
function save(): void {
  const query = props.query
  if (query === null || query === '') return
  const filter = collections.addFilter(query, query)
  void router.push({ path: '/filter', query: { q: query, saved: filter.id } })
}
</script>
