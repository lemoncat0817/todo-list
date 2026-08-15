import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sanitizeState, type Task } from './sanitize'

export const useTodoTaskStore = defineStore(
  'todoTask',
  () => {
    // 稽核 P14：原本這裡還有一個 store 層級的 isEdit，宣告並匯出卻無人使用。
    // pages 移除後它更顯突兀，一併清掉（原訂 Phase 9，提前於此處理）。
    const todoList = ref<Task[]>([])
    const isSearch = ref(false)
    const keyword = ref('')
    return { todoList, isSearch, keyword }
  },
  {
    // 稽核 P2：還原時做形狀驗證，壞資料不再進入 store。
    persist: { sanitize: sanitizeState },
  },
)
