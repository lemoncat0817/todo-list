import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import todoMain from '@/components/todoMain.vue'

export { FILTERS, type FilterTab, type TaskFilter } from './filters'

/**
 * 篩選狀態改由網址決定，取代原本存在 store 裡的 pages 數字。
 * 好處是可深連結、可分享、上一頁/下一頁符合直覺，
 * 也不會再有「持久化了一個超出範圍的數字」這種問題（稽核 P3）。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'all', component: todoMain, props: { filter: 'all' } },
  { path: '/active', name: 'active', component: todoMain, props: { filter: 'active' } },
  { path: '/completed', name: 'completed', component: todoMain, props: { filter: 'completed' } },
  // 未知路徑退回全部，而不是留下空白畫面
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  // GitHub Pages 沒有 SPA fallback（已實測 /Vue-TodoList/active 回 404），
  // 用 hash 模式就不需要 404.html 這類技巧，重新整理也不會掛。
  history: createWebHashHistory(),
  routes,
})

export default router
