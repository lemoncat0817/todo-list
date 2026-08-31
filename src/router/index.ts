import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import TaskListView from '@/components/TaskListView.vue'
import StatsView from '@/components/StatsView.vue'
import type { ViewKind } from '@/domain/views'

/**
 * 檢視狀態由網址承載，不是 store 裡的一個數字。
 * 可深連結、可分享、上一頁／下一頁符合直覺，也不會持久化出一個超出範圍的值（稽核 P3）。
 *
 * 路由表從三個固定篩選擴充成完整的檢視空間（今天／即將到來／收件匣／專案／標籤），
 * 是因為每多一個「只存在於 store 裡」的檢視，就多一個不能分享也不能回上一頁的畫面。
 */

export interface NavEntry {
  kind: ViewKind
  label: string
  path: string
}

/** 以時間與收納為軸的主要入口，順序即建議的使用順序。 */
export const PRIMARY_VIEWS: readonly NavEntry[] = [
  { kind: 'today', label: '今天', path: '/today' },
  { kind: 'upcoming', label: '即將到來', path: '/upcoming' },
  { kind: 'inbox', label: '收件匣', path: '/inbox' },
]

/**
 * 次要入口。「已完成」放這裡而不是與「今天」並列：
 * 已完成的事是歷史紀錄，不是待辦的一個面向。
 */
export const SECONDARY_VIEWS: readonly NavEntry[] = [
  { kind: 'all', label: '全部', path: '/all' },
  { kind: 'active', label: '未完成', path: '/active' },
  { kind: 'completed', label: '已完成', path: '/completed' },
]

export const FIXED_VIEWS: readonly NavEntry[] = [...PRIMARY_VIEWS, ...SECONDARY_VIEWS]

export const routes: RouteRecordRaw[] = [
  // 預設落地在「今天」而不是「全部」：打開工具時最該回答的問題是
  // 「現在要做什麼」，而不是「我總共欠了幾件事」。
  { path: '/', redirect: '/today' },

  ...FIXED_VIEWS.map(
    (entry): RouteRecordRaw => ({
      path: entry.path,
      name: entry.kind,
      component: TaskListView,
      props: { viewKind: entry.kind, viewId: null },
    }),
  ),

  {
    path: '/project/:id',
    name: 'project',
    component: TaskListView,
    props: (route) => ({ viewKind: 'project', viewId: String(route.params.id) }),
  },
  {
    path: '/label/:id',
    name: 'label',
    component: TaskListView,
    props: (route) => ({ viewKind: 'label', viewId: String(route.params.id) }),
  },
  {
    // 查詢放在 query 而不是路徑參數：查詢字串裡有 & | # 這些字元，
    // 塞進路徑得層層轉義，而 query 天生就是放這種東西的地方。
    path: '/filter',
    name: 'filter',
    component: TaskListView,
    props: (route) => ({ viewKind: 'filter', viewId: String(route.query.q ?? '') }),
  },

  {
    // 統計不是一種「任務檢視」，而是對完成紀錄的回顧，所以走自己的元件。
    path: '/stats',
    name: 'stats',
    component: StatsView,
    meta: { title: '統計' },
  },

  // 未知路徑退回今天，而不是留下空白畫面
  { path: '/:pathMatch(.*)*', redirect: '/today' },
]

export const router = createRouter({
  // GitHub Pages 沒有 SPA fallback（子路徑下重新整理，例如 /<repo>/active，已實測回 404）。
  // hash 模式不需要 404.html 這類技巧，重新整理也不會掛。
  history: createWebHashHistory(),
  routes,
})

export default router
