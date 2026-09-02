<template>
  <!--
    App shell：整頁高度固定，只有清單區捲動。
    用 100dvh 而非 100vh —— 行動瀏覽器工具列收合時 vh 不會變，
    會造成內容被裁切或多出一段空白（稽核 U2 記錄過的 83px 溢出）。

    版面從「置中的一張卡片」換成三區塊：導覽 / 清單 / 詳情。
    卡片那個形狀撐得住三個分頁，撐不住「今天」「專案」「標籤」這些彼此獨立的入口。
  -->
  <div class="flex h-dvh min-h-dvh overflow-hidden bg-canvas">
    <aside v-if="isDesktop" class="flex shrink-0 flex-col border-r border-line bg-surface"
      :class="prefs.sidebarCollapsed ? 'w-14' : 'w-60 xl:w-64'">
      <div class="flex shrink-0 items-center gap-1 pt-4 pb-1"
        :class="prefs.sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-4'">
        <p v-if="!prefs.sidebarCollapsed" class="truncate text-sm font-semibold tracking-tight text-ink">
          代辦事項
        </p>
        <button type="button" :aria-label="prefs.sidebarCollapsed ? '展開導覽' : '收合導覽'"
          :data-tooltip="prefs.sidebarCollapsed ? '展開' : '收合'"
          class="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          @click="prefs.toggleSidebarCollapsed()">
          <!--
            左側導覽：展開時箭頭朝左（收合會把它推向左邊界），收合時箭頭朝右
            （展開會把內容從左邊界拉出來）——跟右側任務詳情欄互為鏡像，
            不是同一套邏輯複製過去就好（先前這裡兩顆按鈕的朝向剛好都貼反了）。
          -->
          <svg viewBox="0 0 16 16" class="size-3.5 transition-transform"
            :class="{ 'rotate-180': !prefs.sidebarCollapsed }" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6.5 3.5 5 4.5-5 4.5" />
          </svg>
        </button>
      </div>
      <AppSidebar :collapsed="prefs.sidebarCollapsed" @manage="isManaging = true" @data="isDataOpen = true"
        @account="isAccountOpen = true" @members="isMembersOpen = true" />
    </aside>

    <!--
      窄螢幕的抽屜用原生 <dialog>：焦點鎖定、Esc 關閉、背景 inert 都由平台提供。
      自己用 fixed + transform 做抽屜的話，這三件事都得手寫，而且很容易漏掉焦點鎖定。
    -->
    <dialog v-else ref="drawerEl"
      class="m-0 mr-auto h-dvh max-h-none w-[min(80vw,17rem)] max-w-none overflow-hidden border-r border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      @close="ui.closeSidebar()" @cancel="ui.closeSidebar()">
      <div class="flex h-full flex-col">
        <div class="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-1">
          <p class="text-sm font-semibold tracking-tight text-ink">代辦事項</p>
          <button type="button" aria-label="關閉導覽"
            class="grid size-7 place-items-center rounded-md text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
            @click="ui.closeSidebar()">
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <AppSidebar @navigate="ui.closeSidebar()" @manage="openManage" @data="openData"
          @account="openAccount" @members="openMembers" />
      </div>
    </dialog>

    <main class="flex min-w-0 grow flex-col overflow-hidden bg-surface">
      <AppHeader />
      <RouterView />
      <AppFooter />
    </main>

    <TaskDetailPanel v-if="isWide" :task="detailTask" @close="ui.closeDetail()" />
    <TaskDetailDialog v-else :task="detailTask" @close="ui.closeDetail()" />

    <CollectionsDialog :open="isManaging" @close="isManaging = false" />
    <DataDialog :open="isDataOpen" @close="isDataOpen = false" />
    <AccountDialog v-if="isSyncConfigured" :open="isAccountOpen" @close="isAccountOpen = false" />
    <MembersDialog v-if="isSyncConfigured" :open="isMembersOpen" @close="isMembersOpen = false" />
    <CommandPalette :open="ui.isPaletteOpen" @close="ui.closePalette()" />
    <ShortcutsDialog :open="isHelpOpen" @close="isHelpOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import AppSidebar from './components/AppSidebar.vue'
import TaskDetailDialog from './components/TaskDetailDialog.vue'
import TaskDetailPanel from './components/TaskDetailPanel.vue'
import CollectionsDialog from './components/CollectionsDialog.vue'
import DataDialog from './components/DataDialog.vue'
import AccountDialog from './components/AccountDialog.vue'
import MembersDialog from './components/MembersDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import { useHistoryStore } from '@/stores/history'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { usePrefsStore } from '@/stores/prefs'
import { useShortcuts } from '@/composables/useShortcuts'
import { useTheme } from '@/composables/useTheme'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { isSyncConfigured } from '@/sync/config'

const history = useHistoryStore()
const tasks = useTasksStore()
const ui = useUiStore()
const prefs = usePrefsStore()
const router = useRouter()

// 主題在 index.html 的內聯腳本已先套用，這裡接手後續切換與系統偏好變化
useTheme()

/**
 * 兩個斷點，兩件不同的事：
 *   lg  導覽從抽屜變成常駐左欄
 *   xl  詳情從對話框變成常駐右欄（再窄就會把清單擠到讀不下去）
 */
const isDesktop = useMediaQuery('(min-width: 1024px)')
const isWide = useMediaQuery('(min-width: 1280px)')

const isManaging = ref(false)
const isHelpOpen = ref(false)
const isDataOpen = ref(false)
const isAccountOpen = ref(false)
const isMembersOpen = ref(false)
const drawerEl = ref<HTMLDialogElement | null>(null)

const detailTask = computed(
  () => tasks.items.find((t) => t.id === ui.detailTaskId) ?? null,
)

watch([() => ui.isSidebarOpen, isDesktop], ([open]) => {
  const el = drawerEl.value
  if (!el) return
  if (open && !el.open) el.showModal()
  if (!open && el.open) el.close()
})

// 斷點變寬時抽屜會被卸載，狀態若留著，縮回窄版就會莫名彈出抽屜
watch(isDesktop, (desktop) => {
  if (desktop) ui.closeSidebar()
})

/** 抽屜裡開對話框：兩個 modal 疊在一起會讓焦點鎖定互相打架，先關掉抽屜。 */
function openManage(): void {
  ui.closeSidebar()
  isManaging.value = true
}

function openData(): void {
  ui.closeSidebar()
  isDataOpen.value = true
}

function openAccount(): void {
  ui.closeSidebar()
  isAccountOpen.value = true
}

function openMembers(): void {
  ui.closeSidebar()
  isMembersOpen.value = true
}

function focus(selector: string): void {
  const el = document.querySelector<HTMLInputElement>(selector)
  el?.focus()
  el?.select()
}

useShortcuts({
  undo: () => {
    void history.undo()
  },
  focusSearch: () => {
    if (!ui.isSearch) {
      ui.isSearch = true
      void router.isReady().then(() => {
        requestAnimationFrame(() => focus('input[aria-label="搜尋代辦事項"]'))
      })
      return
    }
    focus('input[aria-label="搜尋代辦事項"]')
  },
  focusNew: () => {
    if (ui.isSearch) ui.isSearch = false
    requestAnimationFrame(() => focus('input[aria-label="新增代辦事項"]'))
  },
  palette: () => {
    ui.openPalette()
  },
  help: () => {
    isHelpOpen.value = true
  },
  escape: () => {
    // 對話框開著時 Esc 屬於它——平台會處理關閉，這裡不要再多做一件事，
    // 否則按一次 Esc 會同時關掉對話框與搜尋。
    if (document.querySelector('dialog[open]')) return
    // 批次選取比搜尋更「當下」：正選到一半按 Esc，想取消的是選取
    if (ui.selectedIds.length > 0) {
      ui.clearSelection()
      return
    }
    // 先關掉當前開著的搜尋，跟大部分搜尋框的慣例一致；
    // 沒有搜尋在開時才退而求其次去關 toast 提示。
    if (ui.isSearch) {
      ui.toggleSearch()
      return
    }
    history.dismiss()
  },
})
</script>
