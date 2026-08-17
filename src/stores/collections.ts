import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadProjects, loadTags, saveProjects, saveTags } from '@/db'
import type { StoredProject, StoredTag } from '@/db/schema'
import { nextOrder } from '@/domain/ordering'
import { useHistoryStore } from './history'

/**
 * 專案與標籤。
 *
 * 兩者放在同一個 store 是刻意的：它們是同一類東西（任務的分類維度），
 * 生命週期一致、都很小，硬拆成兩個 store 只會多出樣板而換不到隔離。
 * 任務本體則明確分開——它的量級與變更頻率都不同。
 */
export const useCollectionsStore = defineStore('collections', () => {
  const projects = ref<StoredProject[]>([])
  const tags = ref<StoredTag[]>([])
  const history = useHistoryStore()

  async function load(): Promise<void> {
    projects.value = await loadProjects()
    tags.value = await loadTags()
  }

  async function flush(): Promise<void> {
    await saveProjects(projects.value.map((p) => ({ ...p })))
    await saveTags(tags.value.map((t) => ({ ...t })))
  }

  // ------------------------------------------------------------- 專案

  function addProject(name: string, color = '#1d4ed8'): StoredProject {
    const project: StoredProject = {
      id: crypto.randomUUID(),
      name,
      color,
      order: nextOrder(projects.value),
    }
    projects.value.push(project)
    history.record({
      label: `新增專案「${name}」`,
      undo: () => {
        projects.value = projects.value.filter((p) => p.id !== project.id)
      },
    })
    return project
  }

  /**
   * 刪除專案本身。底下任務的去留由呼叫端（任務 store）決定——
   * 這個 store 不該知道任務的存在，否則兩邊互相依賴。
   */
  function removeProject(id: string): StoredProject | null {
    const project = projects.value.find((p) => p.id === id) ?? null
    if (!project) return null
    projects.value = projects.value.filter((p) => p.id !== id)
    return project
  }

  function restoreProject(project: StoredProject): void {
    projects.value = [...projects.value, project].sort((a, b) => a.order - b.order)
  }

  // ------------------------------------------------------------- 標籤

  function addTag(name: string, color = '#15803d'): StoredTag {
    const tag: StoredTag = { id: crypto.randomUUID(), name, color }
    tags.value.push(tag)
    history.record({
      label: `新增標籤「${name}」`,
      undo: () => {
        tags.value = tags.value.filter((t) => t.id !== tag.id)
      },
    })
    return tag
  }

  function removeTag(id: string): StoredTag | null {
    const tag = tags.value.find((t) => t.id === id) ?? null
    if (!tag) return null
    tags.value = tags.value.filter((t) => t.id !== id)
    return tag
  }

  function restoreTag(tag: StoredTag): void {
    tags.value = [...tags.value, tag]
  }

  return {
    projects,
    tags,
    load,
    flush,
    addProject,
    removeProject,
    restoreProject,
    addTag,
    removeTag,
    restoreTag,
  }
})
