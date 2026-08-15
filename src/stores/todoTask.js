import { defineStore } from 'pinia'
import { ref } from 'vue'
import { safeSerializer } from './sanitize'

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
    // 稽核 P2：反序列化時做形狀驗證，壞資料不再進入 store。
    persist: { serializer: safeSerializer },
  },
)
