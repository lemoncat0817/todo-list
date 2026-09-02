import { describe, it, expect } from 'vitest'
import ListToolbar from '@/components/ListToolbar.vue'
import { usePrefsStore } from '@/stores/prefs'
import { freshPinia, mountWith } from '@/test/helpers'

describe('ListToolbar.vue — 看板／清單切換', () => {
  it('只有專案檢視才顯示切換鈕', () => {
    const pinia = freshPinia()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'all', query: null } })
    expect(w.text()).not.toContain('切換為看板')
  })

  it('專案檢視預設顯示「切換為看板」，點擊寫進 prefs.projectViewMode', async () => {
    const pinia = freshPinia()
    const prefs = usePrefsStore()
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'project', query: null } })
    const button = w.findAll('button').find((b) => b.text().includes('切換'))
    expect(button?.text()).toBe('切換為看板')

    await button?.trigger('click')
    expect(prefs.projectViewMode).toBe('board')
  })

  it('看板模式下排序／分組選單隱藏，按鈕變成「切換為清單」', async () => {
    const pinia = freshPinia()
    const prefs = usePrefsStore()
    prefs.setProjectViewMode('board')
    const w = mountWith(ListToolbar, pinia, { props: { viewKind: 'project', query: null } })

    expect(w.find('#sort-by').exists()).toBe(false)
    expect(w.find('#group-by').exists()).toBe(false)
    const button = w.findAll('button').find((b) => b.text().includes('切換'))
    expect(button?.text()).toBe('切換為清單')

    await button?.trigger('click')
    expect(prefs.projectViewMode).toBe('list')
  })
})
