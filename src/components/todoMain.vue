<template>
  <div class="w-full h-[450px]">
    <div class="w-full h-[50px] flex justify-center items-center">
      <div
        class="w-20 h-4/5 bg-blue-500 border-white border-solid border-2 rounded-lg text-center leading-[40px] text-lg text-white font-bold mx-2 cursor-pointer select-none hover:bg-blue-600 active:bg-blue-800"
        :class="{ 'bg-yellow-400': todoTaskStore.pages === 0 }" @click="todoTaskStore.pages = 0">全部</div>
      <div
        class="w-20 h-4/5 bg-blue-500 border-white border-solid border-2 rounded-lg text-center leading-[40px] text-lg text-white font-bold mx-2 cursor-pointer select-none hover:bg-blue-600 active:bg-blue-800"
        :class="{ 'bg-yellow-400': todoTaskStore.pages === 1 }" @click="checkNotCompletedTask">未完成</div>
      <div
        class="w-20 h-4/5 bg-blue-500 border-white border-solid border-2 rounded-lg text-center leading-[40px] text-lg text-white font-bold mx-2 cursor-pointer select-none hover:bg-blue-600 active:bg-blue-800"
        :class="{ 'bg-yellow-400': todoTaskStore.pages === 2 }" @click="checkCompletedTask">完成</div>
    </div>
    <div class="w-4/5 h-[400px] m-auto overflow-y-auto">
      <div v-for="item in taskList" :key="item.id"
        class="w-full bg-gray-300 border-2 border-white border-solid rounded-lg p-2 mb-2 flex justify-between items-center">
        <input v-model="item.isCompleted" type="checkbox" class="w-6 h-6 cursor-pointer">
        <p v-if="!item.isEdit"
          class="sm:w-[300px] w-[100px] h-full text-xl font-bold text-blue-700 text-center break-all"
          :class="{ 'line-through': item.isCompleted }">
          {{ item.taskName }}
        </p>
        <input v-else placeholder="請輸入編輯內容" v-model="editTaskName" @keyup.enter="saveTask(item)"
          class="text-center sm:w-[300px] text-blue-800 font-bold border-white border-2 border-solid rounded-lg w-[100px]">
        <div>
          <button v-if="!item.isEdit" @click="editTask(item)"
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

<script setup>
import { ref, computed } from 'vue'
import { useTodoTaskStore } from '@/stores/todoTask'
const todoTaskStore = useTodoTaskStore()

const editTaskName = ref('')

const editTask = (task) => {
  if (todoTaskStore.todoList.some((item) => item.isEdit === true)) {
    alert('有待辦事項尚未保存，請先完成編輯')
    return
  }
  task.isEdit = true
  editTaskName.value = task.taskName
}
const saveTask = (task) => {
  if (editTaskName.value === '') {
    alert('請輸入編輯內容')
    return
  }
  task.isEdit = false
  task.taskName = editTaskName.value
  editTaskName.value = ''
}

const deleteTask = (id) => {
  todoTaskStore.todoList = todoTaskStore.todoList.filter((item) => item.id !== id)
}

const taskList = computed(() => {
  if (todoTaskStore.keyword === '') {
    if (todoTaskStore.pages === 0) {
      return todoTaskStore.todoList
    } else if (todoTaskStore.pages === 1) {
      return todoTaskStore.todoList.filter((item) => !item.isCompleted)
    } else if (todoTaskStore.pages === 2) {
      return todoTaskStore.todoList.filter((item) => item.isCompleted)
    }
  } else {
    if (todoTaskStore.pages === 0) {
      return todoTaskStore.todoList.filter((item) => item.taskName.includes(todoTaskStore.keyword))
    } else if (todoTaskStore.pages === 1) {
      return todoTaskStore.todoList.filter((item) => !item.isCompleted && item.taskName.includes(todoTaskStore.keyword))
    } else if (todoTaskStore.pages === 2) {
      return todoTaskStore.todoList.filter((item) => item.isCompleted && item.taskName.includes(todoTaskStore.keyword))
    }
  }
})

const checkNotCompletedTask = () => {
  if (todoTaskStore.todoList.some((item) => !item.isCompleted)) {
    todoTaskStore.pages = 1
  } else {
    alert('暫無未完成事項，請先添加')
  }
}

const checkCompletedTask = () => {
  if (todoTaskStore.todoList.some((item) => item.isCompleted)) {
    todoTaskStore.pages = 2
  } else {
    alert('暫無完成事項，請先添加')
  }
}
</script>

<style scoped></style>
