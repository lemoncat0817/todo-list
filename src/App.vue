<template>
  <div
    class="app w-full min-h-[100dvh] bg-gradient-to-r from-purple-500 to-pink-500 flex justify-center items-center p-2">
    <!-- 原本是固定 h-[750px]，內容變豐富後會被裁切。
         改為以內容決定高度並設上限，小螢幕不再產生 83px 的垂直溢出（稽核 U2）。 -->
    <div
      class="w-full max-w-[700px] max-h-[calc(100dvh-1rem)] flex flex-col border-white border-solid border-2 rounded-lg bg-red-500 overflow-hidden">
      <todoHeader />
      <RouterView />
      <todoFooter />
    </div>
  </div>
</template>

<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import todoHeader from './components/todoHeader.vue'
import todoFooter from './components/todoFooter.vue'
import { useTodoTaskStore } from '@/stores/todoTask'
import { useShortcuts } from '@/composables/useShortcuts'

const store = useTodoTaskStore()
const router = useRouter()

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

<style scoped></style>
