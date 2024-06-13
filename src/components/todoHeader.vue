<template>
  <div class="w-full h-[150px] pt-6">
    <div class="w-4/5 m-auto flex justify-between items-center">
      <h1 class="text-black text-3xl font-bold">Todo List</h1>
      <button @click="searchMode"
        class="border-2 border-solid border-black rounded-lg px-1 text-white sm:text-2xl font-bold bg-green-500 ease-in-out duration-300 select-none hover:scale-[1.2] hover:bg-green-600 active:bg-green-800">搜尋模式🔍</button>
    </div>
    <div class="w-4/5 m-auto flex justify-center items-center mt-6 px-2">
      <input v-model="isAll" type="checkbox" class="w-10 h-10 cursor-pointer"
        :class="{ 'invisible': todoTaskStore.todoList.length === 0 }">
      <div v-if="!todoTaskStore.isSearch" class="w-full flex justify-center items-center"
        :class="{ 'invisible': todoTaskStore.isSearch }">
        <input placeholder="請輸入代辦事項" v-model.trim="task" @keyup.enter="addTask"
          class="text-center w-1/3 h-10 text-blue-600 font-bold text-lg px-2 border-2 border-black rounded-lg ease-in-out duration-500 focus:w-1/2 focus:border-blue-500 focus:outline-none">
        <button @click="addTask"
          class="w-10 h-10 bg-blue-500 text-3xl text-white rounded-md ml-2 ease-in-out duration-300 hover:scale-[1.2] hover:bg-blue-600 active:bg-blue-800 select-none">
          +
        </button>
      </div>
      <div v-else class="w-full flex justify-center items-center">
        <input placeholder="請輸入關鍵字" v-model.trim="todoTaskStore.keyword"
          class="text-center w-1/3 h-10 text-blue-600 font-bold text-lg px-2 border-2 border-black rounded-lg ease-in-out duration-500 focus:w-1/2 focus:border-blue-500 focus:outline-none">
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useTodoTaskStore } from '@/stores/todoTask'
const todoTaskStore = useTodoTaskStore()

const task = ref('')
const addTask = () => {
  if (task.value === '') {
    return alert('請輸入代辦事項')
  }
  todoTaskStore.todoList.push({
    id: Date.now(),
    taskName: task.value,
    isCompleted: false,
    isEdit: false
  })
  task.value = ''
}

const isAll = computed({
  get: () => {
    return todoTaskStore.todoList.every(item => item.isCompleted)
  },
  set: (newValue) => {
    todoTaskStore.todoList.forEach(item => {
      item.isCompleted = newValue
    })
  }
})

const searchMode = () => {
  todoTaskStore.isSearch = !todoTaskStore.isSearch
  todoTaskStore.keyword = ''
  task.value = ''
}
</script>

<style scoped></style>
