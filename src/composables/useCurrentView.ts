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

  const spec = computed<ViewSpec>(() => ({
    // 導覽過程中路由名稱可能短暫是 undefined；退回「全部」而不是讓畫面空掉
    kind: isViewKind(route.name) ? route.name : 'all',
    id: typeof route.params.id === 'string' ? route.params.id : null,
  }))

  const title = computed(() =>
    viewTitle(spec.value, { projects: collections.projects, tags: collections.tags }),
  )

  return { spec, title }
}
