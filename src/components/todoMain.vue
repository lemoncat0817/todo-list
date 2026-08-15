<template>
  <div class="w-full h-[450px]">
    <nav class="w-full h-[50px] flex justify-center items-center">
      <RouterLink v-for="tab in FILTERS" :key="tab.filter" :to="tab.path"
        :aria-current="tab.filter === props.filter ? 'page' : undefined"
        class="w-20 h-4/5 bg-blue-500 border-white border-solid border-2 rounded-lg text-center leading-[40px] text-lg text-white font-bold mx-2 cursor-pointer select-none hover:bg-blue-600 active:bg-blue-800"
        :class="{ 'bg-yellow-400': tab.filter === props.filter }">{{ tab.label }}</RouterLink>
    </nav>
    <div class="w-4/5 h-[400px] m-auto overflow-y-auto">
      <div v-for="item in taskList" :key="item.id"
        class="w-full bg-gray-300 border-2 border-white border-solid rounded-lg p-2 mb-2 flex justify-between items-center">
        <input v-model="item.isCompleted" type="checkbox" class="w-6 h-6 cursor-pointer">
        <p v-if="editingId !== item.id"
          class="sm:w-[300px] w-[100px] h-full text-xl font-bold text-blue-700 text-center break-all"
          :class="{ 'line-through': item.isCompleted }">
          {{ item.taskName }}
        </p>
        <input v-else placeholder="請輸入編輯內容" v-model="editTaskName" @keyup.enter="saveTask(item)"
          class="text-center sm:w-[300px] text-blue-800 font-bold border-white border-2 border-solid rounded-lg w-[100px]">
        <div>
          <button v-if="editingId !== item.id" @click="editTask(item)"
            class="sm:w-12 w-10 h-8 bg-red-500 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-600 active:bg-red-800">編輯</button>
          <button v-else @click="saveTask(item)"
            class="sm:w-12 w-10 h-8 bg-red-500 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-600 active:bg-red-800">保存</button>
          <button @click="deleteTask(item.id)"
            class="sm:w-12 w-10 h-8 bg-red-500 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-600 active:bg-red-800">刪除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useTodoTaskStore } from '@/stores/todoTask'
import { FILTERS, type TaskFilter } from '@/router'
import type { Task, TaskId } from '@/stores/sanitize'

// 篩選狀態由路由決定，不再存在 store 裡（原本的 pages 數字已移除）。
const props = withDefaults(defineProps<{ filter?: TaskFilter }>(), { filter: 'all' })

const todoTaskStore = useTodoTaskStore()

// 稽核 P1：編輯狀態是 UI 暫態，改為元件區域狀態，不再隨 todoList 被持久化。
// 這樣重新整理後一律回到閱讀狀態，原文字完好，也不會鎖住整份清單。
const editingId = ref<TaskId | null>(null)
const editTaskName = ref('')

const editTask = (task: Task) => {
  if (editingId.value !== null) {
    alert('有待辦事項尚未保存，請先完成編輯')
    return
  }
  editingId.value = task.id
  editTaskName.value = task.taskName
}
const saveTask = (task: Task) => {
  if (editTaskName.value === '') {
    alert('請輸入編輯內容')
    return
  }
  task.taskName = editTaskName.value
  editingId.value = null
  editTaskName.value = ''
}

const deleteTask = (id: TaskId) => {
  // 刪掉的正好是編輯中的那筆時，一併結束編輯狀態
  if (editingId.value === id) {
    editingId.value = null
    editTaskName.value = ''
  }
  todoTaskStore.todoList = todoTaskStore.todoList.filter((item) => item.id !== id)
}

// 稽核 P3：原本用 if / else if 且沒有收尾分支，pages 為非預期值時回傳 undefined。
// 現在改由路由驅動，filter 是封閉的字面量聯集，switch 有 default 收尾，
// 型別層面就不可能再出現「未涵蓋的值」。
const taskList = computed<Task[]>(() => {
  const keyword = todoTaskStore.keyword
  const matched =
    keyword === ''
      ? todoTaskStore.todoList
      : todoTaskStore.todoList.filter((item) => item.taskName.includes(keyword))

  switch (props.filter) {
    case 'active':
      return matched.filter((item) => !item.isCompleted)
    case 'completed':
      return matched.filter((item) => item.isCompleted)
    default:
      return matched
  }
})
</script>

<style scoped></style>
