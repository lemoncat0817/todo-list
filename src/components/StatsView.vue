<template>
  <div class="min-h-0 grow overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
    <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      <div v-for="tile in tiles" :key="tile.label" class="bg-surface px-4 py-3">
        <dt class="text-sm text-ink-faint">{{ tile.label }}</dt>
        <dd class="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{{ tile.value }}</dd>
      </div>
    </dl>

    <section class="mt-6">
      <h2 class="text-sm font-semibold tracking-tight text-ink-soft">最近 14 天</h2>

      <p v-if="stats.totalCompleted === 0" class="mt-3 text-sm text-ink-faint">
        還沒有完成紀錄。完成第一件事之後，這裡會開始有東西。
      </p>

      <!--
        用一排帶標籤的長條而不是圖表函式庫：這裡只需要「哪天多、哪天少」，
        每一根同時是可讀的文字（日期與數量），不必依賴顏色或懸停才讀得到值。
      -->
      <ol v-else class="mt-3 flex items-end gap-1.5" :aria-label="`最近 ${stats.daily.length} 天的完成數`">
        <li v-for="day in stats.daily" :key="day.date" class="flex min-w-0 grow flex-col items-center gap-1">
          <span class="text-[11px] tabular-nums text-ink-faint">{{ day.count || '' }}</span>
          <span class="w-full rounded-t bg-accent transition-all"
            :class="day.count === 0 ? 'bg-sunken' : 'bg-accent'"
            :style="{ height: `${barHeight(day.count)}px` }"
            :title="`${day.date}：${day.count} 件`" />
          <span class="text-[10px] tabular-nums text-ink-faint">{{ day.date.slice(8) }}</span>
        </li>
      </ol>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-semibold tracking-tight text-ink-soft">最近完成</h2>
      <p v-if="recent.length === 0" class="mt-2 text-sm text-ink-faint">還沒有已完成的代辦事項。</p>
      <ul v-else class="mt-2 flex flex-col gap-1">
        <li v-for="task in recent" :key="task.id"
          class="flex items-baseline justify-between gap-3 rounded-lg border border-line px-3 py-2">
          <span class="min-w-0 grow truncate text-[15px] text-ink-soft line-through">
            {{ task.taskName }}
          </span>
          <span class="shrink-0 text-xs tabular-nums text-ink-faint">
            {{ formatCompletedAt(task.completedAt) }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { computeStats } from '@/domain/stats'
import { toISODate } from '@/domain/dates'
import { useTasksStore } from '@/stores/tasks'

/**
 * 完成紀錄與統計。
 *
 * completedAt 從資料模型 v2 起就一直在存，卻從來沒有被讀過——
 * 這一頁把它變成看得到的回顧。計算全部在 domain/stats，這裡只負責呈現。
 */
const MAX_BAR_HEIGHT = 96
const RECENT_LIMIT = 10

const tasks = useTasksStore()

const stats = computed(() => computeStats(tasks.visibleItems))

const tiles = computed(() => [
  { label: '今天完成', value: stats.value.todayCount },
  { label: '最近七天', value: stats.value.weekCount },
  { label: '連續天數', value: stats.value.currentStreak },
  { label: '尚未完成', value: stats.value.remaining },
])

const recent = computed(() =>
  tasks.visibleItems
    .filter((t) => t.isCompleted && t.completedAt !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, RECENT_LIMIT),
)

/** 最高的那一天當作滿格；全部為零時不畫任何高度，免得看起來像有資料。 */
function barHeight(count: number): number {
  const max = Math.max(...stats.value.daily.map((d) => d.count))
  if (max === 0) return 2
  return Math.max(2, Math.round((count / max) * MAX_BAR_HEIGHT))
}

function formatCompletedAt(value: number | null): string {
  if (value === null) return ''
  const date = new Date(value)
  return `${toISODate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>
