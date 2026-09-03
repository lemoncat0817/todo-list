<template>
  <!--
    收合成窄行時，只留得下「有圖示可用」的入口：今天／即將到來／收件匣
    本來就有圖示，專案／標籤／篩選器有顏色圓點可以頂替圖示。次要入口
    （統計、資料與提醒、帳號…）目前完全沒有圖示，硬湊一套新圖示是另一件
    要單獨設計的事，這裡先不做——展開回去就拿得到，不是被藏死。

    這裡用原生 title 而非 data-tooltip：這一條是直向、緊密排列、
    包在 overflow-y-auto 容器裡的圖示列，CSS 提示框不管往哪個方向冒都會
    被同一個容器裁掉（往下冒疊到下一個圖示，往右冒被容器的 overflow-x
    ——因為 overflow-y 非 visible 時 overflow-x 的計算值也會跟著變成
    auto——裁掉，這點是實測出來的，不是猜的）。原生 title 由瀏覽器
    另外一層繪製，不受任何祖先 overflow 影響，這裡換慢一點的原生提示
    換取真的看得到，好過又快又不會出現的提示框。
  -->
  <nav v-if="collapsed" aria-label="檢視" class="flex h-full min-h-0 flex-col items-center gap-3 overflow-y-auto py-2">
    <ul class="flex flex-col gap-0.5">
      <li v-for="entry in PRIMARY_VIEWS" :key="entry.kind">
        <RouterLink :to="entry.path" :class="collapsedLinkClass" :title="entry.label" @click="emit('navigate')">
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
          <span v-if="entry.kind === 'today' && tasks.overdue > 0"
            class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-danger" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>

    <ul v-if="collections.visibleProjects.length > 0" class="flex flex-col gap-1 border-t border-line pt-3">
      <li v-for="project in collections.visibleProjects" :key="project.id">
        <RouterLink :to="`/project/${project.id}`" :class="collapsedLinkClass" :title="project.name"
          @click="emit('navigate')">
          <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: project.color }"
            aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>

    <ul v-if="collections.visibleTags.length > 0" class="flex flex-col gap-1 border-t border-line pt-3">
      <li v-for="tag in collections.visibleTags" :key="tag.id">
        <RouterLink :to="`/label/${tag.id}`" :class="collapsedLinkClass" :title="`#${tag.name}`"
          @click="emit('navigate')">
          <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }"
            aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>
  </nav>

  <nav v-else aria-label="檢視" class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-3 py-4">
    <!--
      只有不只一個工作區時才顯示——多數人只有自己的個人工作區，切換器對
      他們是永遠用不到的雜訊。切這個下拉會真的換掉下面看到的任務／專案／
      標籤／篩選器，不只是換 MembersDialog 在管理誰的成員名單。
    -->
    <label v-if="workspace.workspaces.length > 1" class="flex flex-col gap-1 px-0.5 text-xs font-medium text-ink-faint">
      工作區
      <select :value="workspace.currentWorkspaceId"
        class="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"
        @change="switchWorkspace">
        <option v-for="w in workspace.workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
    </label>

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
        <button v-if="workspace.canWriteCollections || workspace.canManageProjects" type="button" aria-label="管理專案與標籤"
          class="grid size-6 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('manage')">
          <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      </div>

      <p v-if="collections.visibleProjects.length === 0" class="px-2.5 text-sm text-ink-faint">
        還沒有專案
      </p>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="project in collections.visibleProjects" :key="project.id">
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
      <p v-if="collections.visibleTags.length === 0" class="px-2.5 text-sm text-ink-faint">還沒有標籤</p>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="tag in collections.visibleTags" :key="tag.id">
          <RouterLink :to="`/label/${tag.id}`" :class="linkClass" @click="emit('navigate')">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }"
              aria-hidden="true" />
            <span class="min-w-0 grow truncate">#{{ tag.name }}</span>
            <span v-if="tagCount(tag.id) > 0" :class="badgeClass">{{ tagCount(tag.id) }}</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section v-if="collections.visibleFilters.length > 0" class="flex flex-col gap-1">
      <h2 class="px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">篩選器</h2>
      <ul class="flex flex-col gap-0.5">
        <li v-for="filter in collections.visibleFilters" :key="filter.id">
          <RouterLink :to="{ path: '/filter', query: { q: filter.query } }" :class="linkClass"
            @click="emit('navigate')">
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: filter.color }"
              aria-hidden="true" />
            <span class="min-w-0 grow truncate">{{ filter.name }}</span>
            <span v-if="filterCount(filter.query) > 0" :class="badgeClass">
              {{ filterCount(filter.query) }}
            </span>
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
      <li>
        <RouterLink to="/stats" :class="linkClass" @click="emit('navigate')">
          <span class="min-w-0 grow truncate">統計</span>
        </RouterLink>
      </li>
      <li>
        <button type="button" :class="`${linkClass} w-full text-left`" @click="emit('data')">
          <span class="min-w-0 grow truncate">資料與提醒</span>
        </button>
      </li>
      <!--
        沒有接 Supabase（isSyncConfigured 為 false）時整個入口不顯示，
        而不是顯示一個點了會壞掉的按鈕——fork 這個 repo 不接雲端同步的人，
        應該拿到完全正常、看不出這裡少了什麼的純本地版本。
      -->
      <li v-if="isSyncConfigured">
        <button type="button" :class="`${linkClass} w-full text-left`" @click="emit('account')">
          <span class="min-w-0 grow truncate">
            {{ auth.status === 'signed-in' ? '帳號與同步' : '登入以同步' }}
          </span>
          <span v-if="auth.status === 'signed-in'" class="size-2 shrink-0 rounded-full"
            :class="sync.syncError !== null ? 'bg-danger' : 'bg-success'"
            :title="sync.syncError !== null ? `同步失敗：${sync.syncError}` : '同步正常'"
            aria-hidden="true" />
        </button>
      </li>
      <!--
        工作區成員只在已登入時有意義（工作區本身是登入後才會有的概念）——
        跟「帳號與同步」的顯示條件比照，但多一個 signed-in 判斷，不是
        isSyncConfigured 就夠。
      -->
      <li v-if="isSyncConfigured && auth.status === 'signed-in'">
        <button type="button" :class="`${linkClass} w-full text-left`" @click="emit('members')">
          <span class="min-w-0 grow truncate">工作區成員</span>
        </button>
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
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { useWorkspaceStore } from '@/stores/workspace'
import { isSyncConfigured } from '@/sync/config'

/**
 * 側邊導覽。
 *
 * 取代原本的三個分頁。分頁那個形狀只能表達「同一份清單的三種篩選」，
 * 表達不了「今天」「這個專案」這類彼此獨立的入口——而那正是待辦工具真正的骨架。
 *
 * 目前檢視的標示交給 RouterLink 內建的 aria-current="page"，不是只靠底色：
 * 只用顏色表達狀態在螢幕閱讀器上等於沒有表達（稽核 P5/P6）。
 */
withDefaults(defineProps<{ /** 桌面版收合成僅圖示的窄行——抽屜模式一律不收合 */ collapsed?: boolean }>(), {
  collapsed: false,
})

const emit = defineEmits<{
  /** 點了任一連結——抽屜模式下要順手關掉自己 */
  navigate: []
  /** 開啟專案／標籤管理 */
  manage: []
  /** 開啟匯出／匯入與提醒設定 */
  data: []
  /** 開啟帳號與同步設定 */
  account: []
  /** 開啟工作區成員管理 */
  members: []
}>()

const tasks = useTasksStore()
const collections = useCollectionsStore()
const auth = useAuthStore()
const sync = useSyncStore()
const workspace = useWorkspaceStore()

const linkClass =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px] text-ink-soft transition-colors ' +
  'hover:bg-sunken hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium ' +
  'aria-[current=page]:text-accent-ink'

const collapsedLinkClass =
  'relative grid size-9 place-items-center rounded-md text-ink-soft transition-colors ' +
  'hover:bg-sunken hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-ink'

const badgeClass = 'shrink-0 text-xs tabular-nums text-ink-faint'

const countFor = (kind: ViewKind): number => tasks.countOf({ kind, id: null })
const projectCount = (id: string): number => tasks.countOf({ kind: 'project', id })
const tagCount = (id: string): number => tasks.countOf({ kind: 'label', id })
const filterCount = (query: string): number => tasks.countOf({ kind: 'filter', id: query })

/**
 * 切換目前所在的工作區——同一顆 currentWorkspaceId，MembersDialog.vue
 * 拿去決定「管理哪個工作區的成員」，這裡拿去決定「看哪個工作區的任務／
 * 專案／標籤／篩選器」，是同一件事的兩個面向，不是兩個獨立的狀態。
 * 若目前正看著一個不屬於新工作區的專案／標籤／篩選器，畫面會照
 * viewTitle()／resolveView() 既有的「找不到」邏輯優雅降級，不特別導頁。
 */
function switchWorkspace(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  void workspace.selectWorkspace(id)
}
</script>
