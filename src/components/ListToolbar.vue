<template>
  <div class="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3 sm:px-6">
    <!--
      看板模式下排序／分組跟著隱藏：看板有自己的排序軸（區段內的
      rank，見 stores/tasks.ts 的 moveToSection()），這兩個下拉選單
      在看板畫面下不會有任何作用，留著只會讓人誤以為它們還生效。
    -->
    <template v-if="!isBoard">
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
          <option v-for="(label, key) in groupOptions" :key="key" :value="key">分組：{{ label }}</option>
        </select>
      </template>
    </template>

    <!-- 看板／清單切換：只有專案檢視才有區段可以當看板的欄。 -->
    <button v-if="viewKind === 'project'" type="button" :aria-pressed="isBoard"
      class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink transition-colors hover:bg-sunken"
      :class="{ 'bg-accent-soft text-accent-ink': isBoard }"
      @click="prefs.setProjectViewMode(isBoard ? 'list' : 'board')">
      {{ isBoard ? '切換為清單' : '切換為看板' }}
    </button>

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
import { isSyncConfigured } from '@/sync/config'

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

const isBoard = computed(() => props.viewKind === 'project' && prefs.projectViewMode === 'board')

/**
 * 「依負責人」只在接了同步時才有意義——純本機模式下沒有「別人」可以
 * 指派，選單裡出現一個永遠只會分到「未指派」一組的選項只會讓人困惑。
 */
const groupOptions = computed(() =>
  isSyncConfigured
    ? GROUP_LABELS
    : (Object.fromEntries(Object.entries(GROUP_LABELS).filter(([key]) => key !== 'assignee')) as typeof GROUP_LABELS),
)

/** 用查詢字串本身當預設名稱：多數人存下來之後才會想到要改名。 */
function save(): void {
  const query = props.query
  if (query === null || query === '') return
  const filter = collections.addFilter(query, query)
  void router.push({ path: '/filter', query: { q: query, saved: filter.id } })
}
</script>
