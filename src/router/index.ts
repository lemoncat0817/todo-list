import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import TaskListView from '@/components/TaskListView.vue'
import type { TaskFilter } from '@/domain/filtering'

/**
 * 篩選狀態由網址承載，不再是 store 裡的一個數字。
 * 好處是可深連結、可分享、上一頁/下一頁符合直覺，
 * 也不會出現「持久化了一個超出範圍的數字」（稽核 P3）。
 */

export interface FilterTab {
  filter: TaskFilter
  label: string
  path: string
}

export const FILTERS: readonly FilterTab[] = [
  { filter: 'all', label: '全部', path: '/' },
  { filter: 'active', label: '未完成', path: '/active' },
  { filter: 'completed', label: '完成', path: '/completed' },
]

export const routes: RouteRecordRaw[] = [
  ...FILTERS.map(
    (tab): RouteRecordRaw => ({
      path: tab.path,
      name: tab.filter,
      component: TaskListView,
      props: { filter: tab.filter },
    }),
  ),
  // 未知路徑退回全部，而不是留下空白畫面
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  // GitHub Pages 沒有 SPA fallback（已實測 /Vue-TodoList/active 回 404）。
  // hash 模式不需要 404.html 這類技巧，重新整理也不會掛。
  history: createWebHashHistory(),
  routes,
})

export default router
