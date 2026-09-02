<template>
  <p v-if="hasMeta" class="mt-1.5 flex flex-wrap items-center gap-1.5">
    <span v-if="task.priority > 0" :aria-label="`優先度：${PRIORITY_LABELS[task.priority]}`"
      class="inline-flex items-center gap-1 text-[12px] font-medium" :class="priorityClass">
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {{ PRIORITY_LABELS[task.priority] }}
    </span>

    <span v-if="task.dueDate" class="rounded px-1.5 py-0.5 text-[12px] font-medium"
      :class="overdue ? 'bg-danger-soft text-danger-ink' : 'bg-sunken text-ink-soft'">
      {{ describeDue(task.dueDate) }}<template v-if="task.dueTime"> {{ task.dueTime }}</template>
    </span>

    <span v-if="task.recurrence" class="rounded bg-sunken px-1.5 py-0.5 text-[12px] text-ink-soft">
      ↻ {{ describeRecurrence(task.recurrence) }}
    </span>

    <!--
      專案與標籤用「彩色圓點 + 一般文字」而不是彩色底色。
      使用者選的顏色是任意的，拿它當背景就沒辦法保證與文字的對比達標；
      圓點只是輔助辨識，旁邊一定有文字，色盲使用者也不會失去資訊。
    -->
    <span v-if="project" class="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">
      <span class="size-2 rounded-full" :style="{ backgroundColor: project.color }" aria-hidden="true" />
      {{ project.name }}
    </span>

    <span v-for="tag in tags" :key="tag.id"
      class="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">
      <span class="size-2 rounded-full" :style="{ backgroundColor: tag.color }" aria-hidden="true" />
      #{{ tag.name }}
    </span>
  </p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PRIORITY_LABELS, type StoredTask } from '@/db/schema'
import { describeDue, isOverdue } from '@/domain/dates'
import { describeRecurrence } from '@/domain/recurrence'
import { useCollectionsStore } from '@/stores/collections'

/**
 * 任務的中繼資料標記。
 *
 * 從 TaskListView 抽出來的理由不只是「檔案太長」：
 * 標記的呈現規則（逾期變紅、優先度用強度而非彩虹色）是一組獨立的決策，
 * 混在清單元件裡會讓兩者的變更互相牽動。
 */
const props = defineProps<{ task: StoredTask }>()

const collections = useCollectionsStore()

const hasMeta = computed(
  () =>
    props.task.priority > 0 ||
    props.task.dueDate !== null ||
    props.task.recurrence !== null ||
    props.task.projectId !== null ||
    props.task.tagIds.length > 0,
)

// 優先度不用彩虹色，只用強度遞增的單一維度——
// 彩虹色會讓使用者得先背下對照表才看得懂。
const priorityClass = computed(
  () =>
    ({ 0: '', 1: 'text-prio-low', 2: 'text-prio-mid', 3: 'text-prio-high' })[props.task.priority],
)

const overdue = computed(() => isOverdue(props.task.dueDate) && !props.task.isCompleted)
const project = computed(
  () => collections.visibleProjects.find((p) => p.id === props.task.projectId) ?? null,
)
const tags = computed(() => collections.tags.filter((t) => props.task.tagIds.includes(t.id)))
</script>
