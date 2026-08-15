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
void useTodoTaskStore().init()
