import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCollectionsStore } from '@/stores/collections'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 專案／標籤的重名防呆。
 *
 * 修的是一個實測發現的缺口：`addProject`/`addTag` 過去只擋空字串，
 * 同名（甚至大小寫、全形半形不同的同名）可以無限重複建立。
 */

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useCollectionsStore()
}

beforeEach(() => {
  localStorage.clear()
})

describe('addProject 防重名', () => {
  it('同名時回傳既有專案，不建立第二筆', () => {
    const collections = setup()
    const first = collections.addProject('工作')
    const second = collections.addProject('工作')
    expect(second.id).toBe(first.id)
    expect(collections.projects).toHaveLength(1)
  })

  it('大小寫／全形半形不同也視為同名', () => {
    const collections = setup()
    const first = collections.addProject('Work')
    const second = collections.addProject('ｗｏｒｋ') // 全形 + 大小寫都不同
    expect(second.id).toBe(first.id)
    expect(collections.projects).toHaveLength(1)
  })

  it('名稱不同則正常各自建立', () => {
    const collections = setup()
    collections.addProject('工作')
    collections.addProject('生活')
    expect(collections.projects).toHaveLength(2)
  })
})

describe('addTag 防重名', () => {
  it('同名時回傳既有標籤，不建立第二筆', () => {
    const collections = setup()
    const first = collections.addTag('緊急')
    const second = collections.addTag('緊急')
    expect(second.id).toBe(first.id)
    expect(collections.tags).toHaveLength(1)
  })
})

describe('visibleProjects／inboxProjectIds', () => {
  it('新建立的專案一律不是收件匣，會出現在 visibleProjects', () => {
    const collections = setup()
    const project = collections.addProject('工作')
    expect(project.isInbox).toBe(false)
    expect(collections.visibleProjects.map((p) => p.id)).toContain(project.id)
    expect(collections.inboxProjectIds.size).toBe(0)
  })

  it('拉回來的收件匣專案只留在 projects，不會出現在 visibleProjects', () => {
    const collections = setup()
    collections.mergeRemote({
      projects: [
        { id: 'inbox-1', name: '收件匣', color: '#6b7280', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'w1' },
        { id: 'p1', name: '工作', color: '#1d4ed8', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: 'w1' },
      ],
      tags: [],
      filters: [],
    })
    expect(collections.projects.map((p) => p.id).sort()).toEqual(['inbox-1', 'p1'])
    expect(collections.visibleProjects.map((p) => p.id)).toEqual(['p1'])
    expect(collections.inboxProjectIds).toEqual(new Set(['inbox-1']))
  })
})

describe('建立時落在目前所在的工作區', () => {
  it('addProject／addTag／addFilter 都用 workspace.currentWorkspaceId', () => {
    const collections = setup()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'shared-ws'

    expect(collections.addProject('工作').workspaceId).toBe('shared-ws')
    expect(collections.addTag('緊急').workspaceId).toBe('shared-ws')
    expect(collections.addFilter('本週', 'due:week').workspaceId).toBe('shared-ws')
  })

  it('沒有工作區脈絡（純本機模式／尚未登入）時是 null', () => {
    const collections = setup()
    expect(collections.addProject('工作').workspaceId).toBeNull()
  })
})

describe('依工作區篩選看得到的專案／標籤／篩選器', () => {
  function seedTwoWorkspaces() {
    const collections = setup()
    collections.mergeRemote({
      projects: [
        { id: 'p1', name: '工作區1的專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'w1' },
        { id: 'p2', name: '工作區2的專案', color: '#000', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: 'w2' },
      ],
      tags: [],
      filters: [],
    })
    return collections
  }

  it('沒有工作區脈絡時看得到全部（純本機模式／尚未登入不受影響）', () => {
    const collections = seedTwoWorkspaces()
    expect(collections.visibleProjects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('切到某個工作區後，只看得到那個工作區的專案', () => {
    const collections = seedTwoWorkspaces()
    useWorkspaceStore().currentWorkspaceId = 'w1'
    expect(collections.visibleProjects.map((p) => p.id)).toEqual(['p1'])
  })

  it('重名檢查只比對目前所在的工作區：別的工作區同名不算重複', () => {
    const collections = seedTwoWorkspaces()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'w1'

    // w2 已經有一個「工作區2的專案」，但目前在 w1，應該真的新建一筆，
    // 不是被靜默重用成 w2 那筆。
    const created = collections.addProject('工作區2的專案')
    expect(created.id).not.toBe('p2')
    expect(created.workspaceId).toBe('w1')
  })
})
