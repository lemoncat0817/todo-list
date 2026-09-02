import { describe, it, expect } from 'vitest'
import TaskListView from '@/components/TaskListView.vue'
import { useTasksStore } from '@/stores/tasks'
import { usePrefsStore } from '@/stores/prefs'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

describe('TaskListView.vue — 看板／清單切換', () => {
  it('prefs.projectViewMode 為 board 且在專案檢視時渲染 BoardView，不是分組清單', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    usePrefsStore().setProjectViewMode('board')
    const w = mountWith(TaskListView, pinia, { props: { viewKind: 'project', viewId: 'p1' }, router: testRouter() })

    // BoardView 特有的「新增區段」表單，一般清單檢視沒有這段文字。
    expect(w.text()).toContain('新區段名稱')
  })

  it('非專案檢視即使 prefs 是 board 也不受影響，維持清單', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    usePrefsStore().setProjectViewMode('board')
    const w = mountWith(TaskListView, pinia, { props: { viewKind: 'all', viewId: null }, router: testRouter() })

    expect(w.text()).not.toContain('新區段名稱')
  })

  it('專案檢視預設（list）維持既有清單畫面', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    const w = mountWith(TaskListView, pinia, { props: { viewKind: 'project', viewId: 'p1' }, router: testRouter() })

    expect(w.text()).not.toContain('新區段名稱')
  })
})
