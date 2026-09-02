import { describe, it, expect } from 'vitest'
import ListToolbar from '@/components/ListToolbar.vue'
import { freshPinia, mountWith } from '@/test/helpers'

/**
 * 只驗證這次新增的「依負責人」分組選項——排序/其餘分組選項/儲存篩選器
 * 等既有行為沒有專屬測試檔，維持現況不在這裡順手補齊。
 *
 * isSyncConfigured 為 true 的情境見 ListToolbar.assignee.spec.ts（同一個
 * vi.mock 檔案層級生效的坑，見 DataDialog.spec.ts 系列的說明）。
 */
describe('ListToolbar.vue — 依負責人分組（isSyncConfigured 為 false）', () => {
  it('分組選單裡不會出現「依負責人」', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'all', query: null } })
    const options = w.find('#group-by').findAll('option').map((o) => o.text())
    expect(options).not.toContain('分組：負責人')
  })
})
