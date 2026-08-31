import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * UI 互動狀態。
 *
 * 刻意不持久化。搜尋原本跟著 localStorage 走，結果搜尋開著時重新整理頁面，
 * 新增輸入框會被搜尋框取代且回不去——使用者等於卡在搜尋畫面。搜尋是一次性的
 * 操作情境，不是值得記住的偏好。
 *
 * 這裡放的都是「需要跨元件共享的暫態」：側邊欄抽屜由 header 的按鈕開、
 * 由 sidebar 自己關；詳情面板由清單列開、由面板自己關。兩者都不屬於任何
 * 單一元件，也都不值得寫進儲存空間。真正屬於單一元件的暫態（例如某一列
 * 正在編輯）仍然留在元件裡（稽核 P1 的根因）。
 */
export const useUiStore = defineStore('ui', () => {
  const isSearch = ref(false)
  const keyword = ref('')
  const isSidebarOpen = ref(false)
  const detailTaskId = ref<string | null>(null)

  function toggleSearch(): void {
    isSearch.value = !isSearch.value
    // 離開搜尋時清空關鍵字，否則回到清單會看到被過濾過的結果卻沒有可見的原因
    keyword.value = ''
  }

  function openSidebar(): void {
    isSidebarOpen.value = true
  }

  function closeSidebar(): void {
    isSidebarOpen.value = false
  }

  function openDetail(id: string): void {
    detailTaskId.value = id
  }

  function closeDetail(): void {
    detailTaskId.value = null
  }

  return {
    isSearch,
    keyword,
    isSidebarOpen,
    detailTaskId,
    toggleSearch,
    openSidebar,
    closeSidebar,
    openDetail,
    closeDetail,
  }
})
