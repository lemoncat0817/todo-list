<template>
  <div role="region" aria-label="批次操作"
    class="animate-rise flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-4 py-2 sm:px-6">
    <p class="text-sm font-medium text-accent-ink">已選 {{ count }} 項</p>

    <div class="flex flex-wrap items-center gap-1">
      <button type="button" :class="chipClass" @click="complete(true)">完成</button>
      <button type="button" :class="chipClass" @click="complete(false)">取消完成</button>

      <button v-for="option in dateOptions" :key="option.label" type="button" :class="chipClass"
        @click="reschedule(option.value)">
        {{ option.label }}
      </button>

      <label class="sr-only" for="batch-priority">批次設定優先度</label>
      <select id="batch-priority" :value="''" :class="chipClass" @change="setPriority">
        <option value="" disabled>優先度…</option>
        <option v-for="p in PRIORITY_ORDER" :key="p" :value="p">{{ PRIORITY_DESCRIPTIONS[p] }}</option>
      </select>

      <label class="sr-only" for="batch-project">批次移動到專案</label>
      <select id="batch-project" :value="''" :class="chipClass" @change="setProject">
        <option value="" disabled>移到專案…</option>
        <option value="none">未分類</option>
        <option v-for="p in collections.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>

      <button type="button"
        class="rounded-md border border-line bg-surface px-2 py-1 text-sm text-danger-ink transition-colors hover:bg-danger-soft"
        @click="removeSelected">
        刪除
      </button>
    </div>

    <button type="button"
      class="ml-auto rounded-md px-2 py-1 text-sm font-medium text-accent-ink transition-colors hover:bg-surface"
      @click="ui.clearSelection()">
      取消選取
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PRIORITY_DESCRIPTIONS, PRIORITY_ORDER, type Priority } from '@/db/schema'
import { addDays, today, weekdayIndex } from '@/domain/dates'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useCollectionsStore } from '@/stores/collections'

/**
 * 批次操作列。
 *
 * 每個動作在 store 那端都只推一個 undo command——按一次「全部順延到明天」
 * 是一個決定，復原時也該一次回到原狀。
 *
 * 執行完就清空選取：留著已經被改過的選取，下一個動作很容易誤觸在同一批上。
 */
defineProps<{ count: number }>()

const tasks = useTasksStore()
const ui = useUiStore()
const collections = useCollectionsStore()

const chipClass =
  'rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink transition-colors hover:bg-sunken'

const dateOptions = computed(() => {
  const todayISO = today()
  return [
    { label: '今天', value: todayISO },
    { label: '明天', value: addDays(todayISO, 1) },
    { label: '下週', value: addDays(todayISO, (8 - weekdayIndex(todayISO)) % 7 || 7) },
    { label: '清除日期', value: null },
  ]
})

function done(): void {
  ui.clearSelection()
}

function complete(value: boolean): void {
  tasks.batchComplete(ui.selectedIds, value)
  done()
}

function reschedule(value: string | null): void {
  tasks.batchReschedule(ui.selectedIds, value)
  done()
}

function setPriority(event: Event): void {
  const raw = Number((event.target as HTMLSelectElement).value)
  if (!Number.isInteger(raw)) return
  tasks.batchUpdate(ui.selectedIds, { priority: raw as Priority }, `設為 P${4 - raw}`)
  done()
}

function setProject(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === '') return
  const projectId = raw === 'none' ? null : raw
  const name = projectId === null ? '未分類' : (collections.projects.find((p) => p.id === projectId)?.name ?? '專案')
  tasks.batchUpdate(ui.selectedIds, { projectId }, `移到「${name}」`)
  done()
}

function removeSelected(): void {
  tasks.batchRemove(ui.selectedIds)
  done()
}
</script>
