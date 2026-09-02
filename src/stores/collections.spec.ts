import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCollectionsStore } from '@/stores/collections'

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
        { id: 'inbox-1', name: '收件匣', color: '#6b7280', rank: 'A', updatedAt: 1, isInbox: true },
        { id: 'p1', name: '工作', color: '#1d4ed8', rank: 'B', updatedAt: 1, isInbox: false },
      ],
      tags: [],
      filters: [],
    })
    expect(collections.projects.map((p) => p.id).sort()).toEqual(['inbox-1', 'p1'])
    expect(collections.visibleProjects.map((p) => p.id)).toEqual(['p1'])
    expect(collections.inboxProjectIds).toEqual(new Set(['inbox-1']))
  })
})
