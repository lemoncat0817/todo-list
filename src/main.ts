import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/style/reset.css'
import '@/style.css'
import { createPersistPlugin } from '@/stores/persist'

const app = createApp(App)
const pinia = createPinia()
pinia.use(createPersistPlugin())
app.use(pinia)

app.mount('#app')
