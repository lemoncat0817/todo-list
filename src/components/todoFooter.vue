<template>
  <div class="w-full min-h-[100px] flex flex-col items-center justify-center gap-2 px-2 py-2">
    <div class="w-full flex flex-wrap items-center justify-center gap-2">
      <div class="bg-blue-700 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg">
        全部: {{ counts.all }} 項
      </div>
      <div class="bg-blue-700 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg">
        未完成: {{ counts.active }} 項
      </div>
      <div class="bg-blue-700 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg">
        已完成: {{ counts.completed }} 項
      </div>
      <button
        class="bg-blue-900 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg select-none hover:bg-blue-800 disabled:opacity-50"
        :disabled="counts.completed === 0" @click="store.clearCompleted()">
        清除已完成代辦事項
      </button>
    </div>

    <!-- 稽核 P15 / P16：破壞性操作不再用阻塞式 confirm 攔一次，
         改為做完之後可復原。不打斷流程，而且真的救得回來。 -->
    <p v-if="store.lastAction" role="status" aria-live="polite"
      class="w-full max-w-[600px] flex items-center justify-center gap-2 bg-white border-2 border-black rounded-lg px-2 py-1 text-blue-900 font-bold">
      <span class="truncate">{{ store.lastAction }}</span>
      <button v-if="store.canUndo"
        class="bg-blue-900 text-white rounded px-2 py-0.5 shrink-0 hover:bg-blue-800"
        @click="store.undo()">復原</button>
      <button class="text-blue-900 rounded px-1 shrink-0 hover:underline" aria-label="關閉提示"
        @click="store.dismissAction()">✕</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTodoTaskStore } from '@/stores/todoTask'

const store = useTodoTaskStore()

const counts = computed(() => {
  const all = store.todoList.length
  const completed = store.todoList.filter((t) => t.isCompleted).length
  return { all, completed, active: all - completed }
})
</script>

<style scoped></style>
