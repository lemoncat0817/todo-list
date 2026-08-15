import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/style/reset.css'
import '@/style.css'
import { createPersistPlugin } from '@/stores/persist'
import router from '@/router'
import { useTodoTaskStore } from '@/stores/todoTask'

const app = createApp(App)
const pinia = createPinia()
pinia.use(createPersistPlugin())
app.use(pinia)
app.use(router)

// 先掛載再載入資料：畫面立刻可見，載入中的狀態由元件呈現。
app.mount('#app')

const store = useTodoTaskStore()
void store.init()

/**
 * 離開頁面前盡力把未完成的寫入送出去。
 *
 * 寫入本身已經是即時觸發（沒有防抖），但 IndexedDB 是非同步的，
 * 「操作後立刻關閉或重新整理」仍有極短的空窗。這裡不能保證一定寫成
 * （瀏覽器可能在交易完成前就終止分頁），但能把空窗縮到最小。
 * pagehide 比 beforeunload 可靠：行動瀏覽器的分頁凍結只會觸發前者。
 */
window.addEventListener('pagehide', () => {
  void store.flush()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void store.flush()
})
