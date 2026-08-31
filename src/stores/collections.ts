import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadProjects, loadTags, saveProjects, saveTags } from '@/db'
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  type StoredProject,
  type StoredTag,
} from '@/db/schema'
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

  function addProject(name: string, color = DEFAULT_PROJECT_COLOR): StoredProject {
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
   * 改名與換色。走同一個入口而不是各寫一支，是因為兩者的復原邏輯完全相同：
   * 記住整筆舊值再放回去，不需要為每個欄位維護一份反向操作。
   */
  function updateProject(id: string, patch: Partial<Omit<StoredProject, 'id'>>): void {
    const index = projects.value.findIndex((p) => p.id === id)
    if (index === -1) return
    const before = { ...(projects.value[index] as StoredProject) }
    const after = { ...before, ...patch }
    projects.value[index] = after
    history.record({
      label: `修改專案「${before.name}」`,
      undo: () => {
        const i = projects.value.findIndex((p) => p.id === id)
        if (i !== -1) projects.value[i] = before
      },
      redo: () => {
        const i = projects.value.findIndex((p) => p.id === id)
        if (i !== -1) projects.value[i] = after
      },
    })
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

  function addTag(name: string, color = DEFAULT_TAG_COLOR): StoredTag {
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

  function updateTag(id: string, patch: Partial<Omit<StoredTag, 'id'>>): void {
    const index = tags.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const before = { ...(tags.value[index] as StoredTag) }
    const after = { ...before, ...patch }
    tags.value[index] = after
    history.record({
      label: `修改標籤「${before.name}」`,
      undo: () => {
        const i = tags.value.findIndex((t) => t.id === id)
        if (i !== -1) tags.value[i] = before
      },
      redo: () => {
        const i = tags.value.findIndex((t) => t.id === id)
        if (i !== -1) tags.value[i] = after
      },
    })
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
    updateProject,
    removeProject,
    restoreProject,
    addTag,
    updateTag,
    removeTag,
    restoreTag,
  }
})
