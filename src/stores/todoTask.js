import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTodoTaskStore = defineStore(
  'todoTask',
  () => {
    const isEdit = ref(false)
    const todoList = ref([])
    const pages = ref(0)
    const isSearch = ref(false)
    const keyword = ref('')
    return { isEdit, todoList, pages, isSearch, keyword }
  },
  {
    persist: true,
  },
)