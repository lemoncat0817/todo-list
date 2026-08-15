import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sanitizeState, type Pages, type Task } from './sanitize'

export const useTodoTaskStore = defineStore(
  'todoTask',
  () => {
    const isEdit = ref(false)
    const todoList = ref<Task[]>([])
    const pages = ref<Pages>(0)
    const isSearch = ref(false)
    const keyword = ref('')
    return { isEdit, todoList, pages, isSearch, keyword }
  },
  {
    // 稽核 P2：還原時做形狀驗證，壞資料不再進入 store。
    persist: { sanitize: sanitizeState },
  },
)
