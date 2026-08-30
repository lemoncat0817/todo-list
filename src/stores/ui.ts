import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * UI 互動狀態：搜尋模式與關鍵字。
 *
 * 刻意不持久化。這裡原本跟著 localStorage 走，結果搜尋開著時重新整理頁面，
 * 新增輸入框會被搜尋框取代且回不去——使用者等於卡在搜尋畫面。搜尋是一次性的
 * 操作情境，不是值得記住的偏好，所以改成單純的記憶體狀態，重新整理就重置。
 */
export const useUiStore = defineStore('ui', () => {
  const isSearch = ref(false)
  const keyword = ref('')

  function toggleSearch(): void {
    isSearch.value = !isSearch.value
    // 離開搜尋時清空關鍵字，否則回到清單會看到被過濾過的結果卻沒有可見的原因
    keyword.value = ''
  }

  return { isSearch, keyword, toggleSearch }
})
