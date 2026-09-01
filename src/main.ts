import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/style.css'
import { createPersistPlugin } from '@/infra/persist'
import router from '@/router'
import { useTasksStore } from '@/stores/tasks'

const app = createApp(App)
const pinia = createPinia()
pinia.use(createPersistPlugin())
app.use(pinia)
app.use(router)

// 先掛載再載入資料：畫面立刻可見，載入中的狀態由元件呈現。
app.mount('#app')

const store = useTasksStore()
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

/**
 * 註冊 service worker，讓工具可以離線使用、也可以安裝到桌面。
 *
 * 只在正式建置註冊：開發時 Vite 的模組是動態產生的，
 * 一個會攔截請求的 worker 只會讓熱更新變得難以預測。
 * 路徑用相對的 './sw.js'，GitHub Pages 的子路徑部署才找得到它。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href, { scope: './' })
      // 註冊失敗不影響任何功能，不需要打擾使用者
      .catch(() => {})
  })
}
