<template>
  <nav aria-label="檢視" class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-3 py-4">
    <ul class="flex flex-col gap-0.5">
      <li v-for="entry in PRIMARY_VIEWS" :key="entry.kind">
        <RouterLink :to="entry.path" :class="linkClass" @click="emit('navigate')">
          <span class="grid size-5 shrink-0 place-items-center" aria-hidden="true">
            <svg v-if="entry.kind === 'today'" viewBox="0 0 20 20" class="size-4.5" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
              <rect x="3" y="4.5" width="14" height="12" rx="2" />
              <path d="M3 8h14M7 2.8v3.4M13 2.8v3.4" stroke-linecap="round" />
            </svg>
            <svg v-else-if="entry.kind === 'upcoming'" viewBox="0 0 20 20" class="size-4.5" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 5.8V10l2.8 1.8" />
            </svg>
            <svg v-else viewBox="0 0 20 20" class="size-4.5" fill="none" stroke="currentColor"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 11.5 5 4.5h10l2 7v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
              <path d="M3 11.5h3.5l1 2h5l1-2H17" />
            </svg>
          </span>
          <span class="min-w-0 grow truncate">{{ entry.label }}</span>
          <span v-if="entry.kind === 'today' && tasks.overdue > 0"
            class="shrink-0 rounded-full bg-danger-soft px-1.5 text-xs font-medium tabular-nums text-danger-ink">
            逾期 {{ tasks.overdue }}
          </span>
          <span v-else-if="countFor(entry.kind) > 0" :class="badgeClass">{{ countFor(entry.kind) }}</span>
        </RouterLink>
      </li>
    </ul>

    <section class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-1 pl-2.5 pr-1">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-ink-faint">專案</h2>
        <button type="button" aria-label="管理專案與標籤"
          class="grid size-6 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('manage')">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      </div>

      <p v-if="collections.projects.length === 0" class="px-2.5 text-sm text-ink-faint">
        還沒有專案
      </p>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="project in collections.projects" :key="project.id">
          <RouterLink :to="`/project/${project.id}`" :class="linkClass" @click="emit('navigate')">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: project.color }"
              aria-hidden="true" />
            <span class="min-w-0 grow truncate">{{ project.name }}</span>
            <span v-if="projectCount(project.id) > 0" :class="badgeClass">{{ projectCount(project.id) }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-1">
      <h2 class="px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">標籤</h2>
      <p v-if="collections.tags.length === 0" class="px-2.5 text-sm text-ink-faint">還沒有標籤</p>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="tag in collections.tags" :key="tag.id">
          <RouterLink :to="`/label/${tag.id}`" :class="linkClass" @click="emit('navigate')">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }"
              aria-hidden="true" />
            <span class="min-w-0 grow truncate">#{{ tag.name }}</span>
            <span v-if="tagCount(tag.id) > 0" :class="badgeClass">{{ tagCount(tag.id) }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- 次要入口壓在底部：它們是回顧用的，不是每天的起點 -->
    <ul class="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
      <li v-for="entry in SECONDARY_VIEWS" :key="entry.kind">
        <RouterLink :to="entry.path" :class="linkClass" @click="emit('navigate')">
          <span class="min-w-0 grow truncate">{{ entry.label }}</span>
          <span v-if="countFor(entry.kind) > 0" :class="badgeClass">{{ countFor(entry.kind) }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { PRIMARY_VIEWS, SECONDARY_VIEWS } from '@/router'
import type { ViewKind } from '@/domain/views'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'

/**
 * 側邊導覽。
 *
 * 取代原本的三個分頁。分頁那個形狀只能表達「同一份清單的三種篩選」，
 * 表達不了「今天」「這個專案」這類彼此獨立的入口——而那正是待辦工具真正的骨架。
 *
 * 目前檢視的標示交給 RouterLink 內建的 aria-current="page"，不是只靠底色：
 * 只用顏色表達狀態在螢幕閱讀器上等於沒有表達（稽核 P5/P6）。
 */
const emit = defineEmits<{
  /** 點了任一連結——抽屜模式下要順手關掉自己 */
  navigate: []
  /** 開啟專案／標籤管理 */
  manage: []
}>()

const tasks = useTasksStore()
const collections = useCollectionsStore()

const linkClass =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px] text-ink-soft transition-colors ' +
  'hover:bg-sunken hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium ' +
  'aria-[current=page]:text-accent-ink'

const badgeClass = 'shrink-0 text-xs tabular-nums text-ink-faint'

const countFor = (kind: ViewKind): number => tasks.countOf({ kind, id: null })
const projectCount = (id: string): number => tasks.countOf({ kind: 'project', id })
const tagCount = (id: string): number => tasks.countOf({ kind: 'label', id })
</script>
