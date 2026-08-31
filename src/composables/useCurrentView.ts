import { computed, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { viewTitle, type ViewKind, type ViewSpec } from '@/domain/views'
import { useCollectionsStore } from '@/stores/collections'

/**
 * 目前所在的檢視，直接從網址推導。
 *
 * 路由名稱刻意與 ViewKind 同名，這裡才不需要維護第二份對照表——
 * 對照表一旦有兩份，遲早會有人只改其中一份。
 */
const VIEW_KINDS: readonly ViewKind[] = [
  'today',
  'upcoming',
  'inbox',
  'all',
  'active',
  'completed',
  'project',
  'label',
  'filter',
]

function isViewKind(value: unknown): value is ViewKind {
  return typeof value === 'string' && (VIEW_KINDS as readonly string[]).includes(value)
}

export function useCurrentView(): {
  spec: ComputedRef<ViewSpec>
  title: ComputedRef<string>
} {
  const route = useRoute()
  const collections = useCollectionsStore()

  const spec = computed<ViewSpec>(() => {
    // 導覽過程中路由名稱可能短暫是 undefined；退回「全部」而不是讓畫面空掉
    const kind = isViewKind(route.name) ? route.name : 'all'
    // filter 檢視的「id」是查詢字串本身，它放在 query 而不是路徑參數
    if (kind === 'filter') return { kind, id: typeof route.query.q === 'string' ? route.query.q : '' }
    return { kind, id: typeof route.params.id === 'string' ? route.params.id : null }
  })

  const title = computed(() => {
    // 不是任務檢視的頁面（例如統計）用路由自己宣告的標題
    if (typeof route.meta.title === 'string') return route.meta.title
    // 存過的篩選器顯示它的名字，而不是一長串查詢語法
    if (spec.value.kind === 'filter') {
      const saved = collections.filters.find((f) => f.query === spec.value.id)
      return saved?.name ?? (spec.value.id === null || spec.value.id === '' ? '篩選器' : spec.value.id)
    }
    return viewTitle(spec.value, { projects: collections.projects, tags: collections.tags })
  })

  return { spec, title }
}
