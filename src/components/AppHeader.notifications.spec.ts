import { describe, it, expect, vi } from 'vitest'
import AppHeader from '@/components/AppHeader.vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

// 理由同 DataDialog.push.spec.ts：isSyncConfigured 為 true 的情境需要
// 獨立成一支檔案。
vi.mock('@/sync/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/config')>()),
  isSyncConfigured: true,
}))

describe('AppHeader.vue — 通知鈴鐺', () => {
  it('未登入時不顯示', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    const w = mountWith(AppHeader, pinia, { router: testRouter() })
    expect(w.find('button[aria-label="通知"]').exists()).toBe(false)
  })

  it('已登入時顯示，沒有未讀時不顯示紅點', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    useAuthStore().status = 'signed-in'
    const w = mountWith(AppHeader, pinia, { router: testRouter() })
    const bell = w.find('button[aria-label="通知"]')
    expect(bell.exists()).toBe(true)
    expect(bell.text()).not.toContain('則未讀')
  })

  it('有未讀時顯示未讀數（供螢幕閱讀器）', () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    useAuthStore().status = 'signed-in'
    useNotificationsStore().mergeRemote([
      { id: 'n1', actorId: null, kind: 'mention', taskId: 't1', body: '', readAt: null, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountWith(AppHeader, pinia, { router: testRouter() })
    expect(w.find('button[aria-label="通知"]').text()).toContain('1 則未讀')
  })

  it('點擊會發出 notifications 事件', async () => {
    const pinia = freshPinia()
    useTasksStore().isLoading = false
    useAuthStore().status = 'signed-in'
    const w = mountWith(AppHeader, pinia, { router: testRouter() })
    await w.find('button[aria-label="通知"]').trigger('click')
    expect(w.emitted('notifications')).toBeTruthy()
  })
})
