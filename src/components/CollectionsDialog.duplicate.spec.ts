import { describe, it, expect } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import CollectionsDialog from '@/components/CollectionsDialog.vue'
import { useCollectionsStore } from '@/stores/collections'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

/** 只驗證這次新增的「複製專案」按鈕——既有的重新命名/換色/刪除/新增沒有專屬測試檔，維持現況。 */
describe('CollectionsDialog.vue — 複製專案', () => {
  it('點擊複製按鈕會建立一個新專案並導向它', async () => {
    const pinia = freshPinia()
    const collections = useCollectionsStore()
    useTasksStore().isLoading = false
    const project = collections.addProject('工作')
    const router = testRouter()
    await router.push('/today')

    const w = mountWith(CollectionsDialog, pinia, { props: { open: true }, router })
    await w.find(`button[aria-label="複製專案「${project.name}」"]`).trigger('click')
    await flushPromises()

    expect(collections.projects.map((p) => p.name)).toContain('工作 的副本')
    expect(router.currentRoute.value.path).toMatch(/^\/project\//)
    expect(w.emitted('close')).toBeTruthy()
  })
})
