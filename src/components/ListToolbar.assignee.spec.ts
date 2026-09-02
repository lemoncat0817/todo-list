import { describe, it, expect, vi } from 'vitest'
import ListToolbar from '@/components/ListToolbar.vue'
import { usePrefsStore } from '@/stores/prefs'
import { freshPinia, mountWith } from '@/test/helpers'

vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

describe('ListToolbar.vue — 依負責人分組（isSyncConfigured 為 true）', () => {
  it('分組選單裡出現「依負責人」', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'all', query: null } })
    const options = w.find('#group-by').findAll('option').map((o) => o.text())
    expect(options).toContain('分組：負責人')
  })

  it('選擇「依負責人」會寫進 prefs.groupBy', async () => {
    const pinia = freshPinia()
    const prefs = usePrefsStore()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'all', query: null } })
    await w.find('#group-by').setValue('assignee')
    expect(prefs.groupBy).toBe('assignee')
  })

  it('今天／即將到來檢視不顯示分組選單（日期軸自帶分組）', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'today', query: null } })
    expect(w.find('#group-by').exists()).toBe(false)
  })
})
