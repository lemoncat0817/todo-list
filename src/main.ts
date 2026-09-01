import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/style.css'
import { createPersistPlugin } from '@/infra/persist'
import router from '@/router'
import { useTasksStore } from '@/stores/tasks'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { isSyncConfigured } from '@/sync/config'

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
 * 還原既有的登入狀態；同步引擎什麼時候該啟動由 stores/sync.ts 自己
 * watch auth.status 決定，這裡不需要、也不該手動呼叫 start()——手動呼叫
 * 只涵蓋得到「這個分頁自己完成登入」的情況，涵蓋不到跨分頁的情況
 * （例如使用者點的是信件裡的連結，登入在另一個分頁完成，透過
 * stores/auth.ts 的跨分頁廣播反映回這個分頁）。
 *
 * 這裡先呼叫一次 useSyncStore()，只是要讓它的 watcher 在 restore() 的
 * 非同步結果回來之前就已經掛上去，不需要在意呼叫順序。
 *
 * auth.restore() 內部會先檢查有沒有 `todoTask:auth` 這把 localStorage key，
 * 沒有登入過的使用者不會觸發任何 import()，也不會打任何 API——
 * 這裡外層再加一層 isSyncConfigured 判斷，是避免 fork 這個 repo、
 * 沒有接 Supabase 的人連 restore() 都不用呼叫。
 */
if (isSyncConfigured) {
  useSyncStore()
  void useAuthStore().restore()
}

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
