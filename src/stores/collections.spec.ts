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
