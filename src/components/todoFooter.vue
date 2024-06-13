<template>
  <div class="w-full h-[100px] flex items-center justify-around">
    <div class="sm:w-[400px] h-[100px] sm:flex items-center justify-around">
      <div class="bg-blue-500 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg mb-2">{{
        `全部:
        ${todoTaskStore.todoList.length} 項` }}</div>
      <div class="bg-blue-500 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg mb-2">{{
        `未完成:
        ${todoTaskStore.todoList.filter((item) => !item.isCompleted).length} 項` }}</div>
      <div class="bg-blue-500 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg mb-2">{{
        `已完成:
        ${todoTaskStore.todoList.filter((item) => item.isCompleted).length} 項` }}</div>
    </div>
    <button @click="clearTask"
      class="bg-blue-800 border-2 border-solid border-black rounded-lg px-2 text-white font-bold text-lg select-none hover:bg-blue-700 active:bg-blue-900">清除已完成代辦事項</button>
  </div>
</template>

<script setup>
import { useTodoTaskStore } from '@/stores/todoTask'
const todoTaskStore = useTodoTaskStore()

const clearTask = () => {
  const completedTask = todoTaskStore.todoList.filter((item) => item.isCompleted)
  if (completedTask.length === 0) {
    return alert('目前沒有已完成的代辦事項')
  }
  let isClear = confirm('確定要清除所有已完成代辦事項嗎？')
  if (isClear) {
    todoTaskStore.todoList = todoTaskStore.todoList.filter((item) => !item.isCompleted)
    alert('清除成功')
  } else {
    alert('取消操作')
  }
}
</script>

<style scoped></style>
