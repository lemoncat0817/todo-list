<template>
  <!--
    App shell：整頁高度固定、只有清單區捲動。
    用 100dvh 而非 100vh —— 行動瀏覽器工具列收合時 vh 不會變，
    會造成內容被裁切或多出一段空白（稽核 U2 記錄過的 83px 溢出）。
  -->
  <div class="flex min-h-[100dvh] justify-center bg-canvas px-3 py-4 sm:px-6 sm:py-8">
    <main
      class="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg sm:max-h-[calc(100dvh-4rem)]">
      <todoHeader />
      <RouterView />
      <todoFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import todoHeader from './components/todoHeader.vue'
import todoFooter from './components/todoFooter.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { useShortcuts } from '@/composables/useShortcuts'
import { useTheme } from '@/composables/useTheme'

const store = useTodoTaskStore()
const router = useRouter()

// 主題在 index.html 的內聯腳本已先套用，這裡接手後續切換與系統偏好變化
useTheme()

function focus(selector: string): void {
  const el = document.querySelector<HTMLInputElement>(selector)
  el?.focus()
  el?.select()
}

useShortcuts({
  undo: () => {
    void store.undo()
  },
  focusSearch: () => {
    if (!store.isSearch) {
      store.isSearch = true
      void router.isReady().then(() => {
        requestAnimationFrame(() => focus('input[aria-label="搜尋代辦事項"]'))
      })
      return
    }
    focus('input[aria-label="搜尋代辦事項"]')
  },
  focusNew: () => {
    if (store.isSearch) store.isSearch = false
    requestAnimationFrame(() => focus('input[aria-label="新增代辦事項"]'))
  },
  escape: () => {
    store.dismissAction()
  },
})
</script>
