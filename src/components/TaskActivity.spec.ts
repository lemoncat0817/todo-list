import { describe, it, expect, beforeEach } from 'vitest'
import type { Pinia } from 'pinia'
import TaskActivity from '@/components/TaskActivity.vue'
import { useActivityStore } from '@/stores/activity'
import { useAuthStore } from '@/stores/auth'
import { useCollectionsStore } from '@/stores/collections'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith } from '@/test/helpers'

describe('TaskActivity.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    useAuthStore().session = { user: { id: 'me' } } as never
    useWorkspaceStore().members = [
      { user_id: 'me', role: 'owner', joined_at: '2030-01-01', profiles: { display_name: '我自己', avatar_url: null } },
    ]
  })

  const mountActivity = () => mountWith(TaskActivity, pinia, { props: { taskId: 'task-1' } })

  it('沒有活動記錄時整段不顯示', () => {
    const w = mountActivity()
    expect(w.find('section').exists()).toBe(false)
  })

  it('依序顯示建立／完成／取消完成的事件描述', () => {
    useActivityStore().mergeRemote([
      { id: 'a1', taskId: 'task-1', actorId: 'me', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
      { id: 'a2', taskId: 'task-1', actorId: 'me', kind: 'completed', detail: {}, createdAt: 2, updatedAt: 2 },
      { id: 'a3', taskId: 'task-1', actorId: 'me', kind: 'reopened', detail: {}, createdAt: 3, updatedAt: 3 },
    ])
    const w = mountActivity()

    const items = w.findAll('li').map((li) => li.text())
    expect(items[0]).toContain('建立了這個任務')
    expect(items[1]).toContain('完成了這個任務')
    expect(items[2]).toContain('重新開啟了這個任務')
  })

  it('actorId 為 null 時顯示「系統」', () => {
    useActivityStore().mergeRemote([
      { id: 'a1', taskId: 'task-1', actorId: null, kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
    ])
    const w = mountActivity()
    expect(w.text()).toContain('系統')
  })

  it('moved 事件顯示換到的專案名稱', () => {
    useCollectionsStore().projects = [
      { id: 'p1', name: '工作', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'w1' },
    ]
    useActivityStore().mergeRemote([
      {
        id: 'a1', taskId: 'task-1', actorId: 'me', kind: 'moved',
        detail: { from: null, to: 'p1' }, createdAt: 1, updatedAt: 1,
      },
    ])
    const w = mountActivity()
    expect(w.text()).toContain('把任務移到「工作」')
  })

  it('moved 事件找不到專案（已刪除）時顯示「已刪除的專案」', () => {
    useActivityStore().mergeRemote([
      {
        id: 'a1', taskId: 'task-1', actorId: 'me', kind: 'moved',
        detail: { from: null, to: 'gone' }, createdAt: 1, updatedAt: 1,
      },
    ])
    const w = mountActivity()
    expect(w.text()).toContain('把任務移到「已刪除的專案」')
  })

  it('只顯示這筆任務自己的活動記錄', () => {
    useActivityStore().mergeRemote([
      { id: 'a1', taskId: 'task-1', actorId: 'me', kind: 'created', detail: {}, createdAt: 1, updatedAt: 1 },
      { id: 'a2', taskId: 'task-2', actorId: 'me', kind: 'created', detail: {}, createdAt: 2, updatedAt: 2 },
    ])
    const w = mountActivity()
    expect(w.findAll('li')).toHaveLength(1)
  })
})
