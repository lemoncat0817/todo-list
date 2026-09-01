import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadFilters, loadProjects, loadTags, saveFilters, saveProjects, saveTags } from '@/db'
import {
  DEFAULT_FILTER_COLOR,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  type StoredFilter,
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
  const filters = ref<StoredFilter[]>([])
  const history = useHistoryStore()

  async function load(): Promise<void> {
    projects.value = await loadProjects()
    tags.value = await loadTags()
    filters.value = await loadFilters()
  }

  async function flush(): Promise<void> {
    await saveProjects(projects.value.map((p) => ({ ...p })))
    await saveTags(tags.value.map((t) => ({ ...t })))
    await saveFilters(filters.value.map((f) => ({ ...f })))
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

  // ----------------------------------------------------------- 篩選器

  /**
   * 儲存的篩選器。
   *
   * 與專案、標籤放在同一個 store：三者都是「使用者自訂的組織維度」，
   * 生命週期一致、量都很小，硬拆只會多出樣板。
   */
  function addFilter(name: string, query: string, color = DEFAULT_FILTER_COLOR): StoredFilter {
    const filter: StoredFilter = {
      id: crypto.randomUUID(),
      name,
      query,
      color,
      order: nextOrder(filters.value),
    }
    filters.value.push(filter)
    history.record({
      label: `儲存篩選器「${name}」`,
      undo: () => {
        filters.value = filters.value.filter((f) => f.id !== filter.id)
      },
      redo: () => {
        filters.value.push(filter)
      },
    })
    return filter
  }

  function updateFilter(id: string, patch: Partial<Omit<StoredFilter, 'id'>>): void {
    const index = filters.value.findIndex((f) => f.id === id)
    if (index === -1) return
    const before = { ...(filters.value[index] as StoredFilter) }
    const after = { ...before, ...patch }
    filters.value[index] = after
    history.record({
      label: `修改篩選器「${before.name}」`,
      undo: () => {
        const i = filters.value.findIndex((f) => f.id === id)
        if (i !== -1) filters.value[i] = before
      },
      redo: () => {
        const i = filters.value.findIndex((f) => f.id === id)
        if (i !== -1) filters.value[i] = after
      },
    })
  }

  function removeFilter(id: string): void {
    const filter = filters.value.find((f) => f.id === id)
    if (!filter) return
    filters.value = filters.value.filter((f) => f.id !== id)
    history.record({
      label: `刪除篩選器「${filter.name}」`,
      undo: () => {
        filters.value = [...filters.value, filter].sort((a, b) => a.order - b.order)
      },
      redo: () => {
        filters.value = filters.value.filter((f) => f.id !== id)
      },
    })
  }

  /** 供匯入前後快照用：三份清單一起存、一起還原，才不會只回復一半。 */
  function snapshot(): { projects: StoredProject[]; tags: StoredTag[]; filters: StoredFilter[] } {
    return {
      projects: projects.value.map((p) => ({ ...p })),
      tags: tags.value.map((t) => ({ ...t })),
      filters: filters.value.map((f) => ({ ...f })),
    }
  }

  function restoreSnapshot(snap: {
    projects: StoredProject[]
    tags: StoredTag[]
    filters: StoredFilter[]
  }): void {
    projects.value = snap.projects
    tags.value = snap.tags
    filters.value = snap.filters
  }

  /**
   * 套用匯入結果。不自己推 undo command——匯入是一個橫跨兩個 store 的動作，
   * 由任務 store 統一記錄成一個命令，否則使用者要按兩次才回得去。
   */
  function applyImport(
    data: {
      projects: readonly StoredProject[]
      tags: readonly StoredTag[]
      filters: readonly StoredFilter[]
    },
    mode: 'merge' | 'replace',
  ): void {
    const merge = <T extends { id: string }>(existing: T[], incoming: readonly T[]): T[] => {
      if (mode === 'replace') return [...incoming]
      const byId = new Map(existing.map((item) => [item.id, item]))
      for (const item of incoming) byId.set(item.id, item)
      return [...byId.values()]
    }
    projects.value = merge(projects.value, data.projects)
    tags.value = merge(tags.value, data.tags)
    filters.value = merge(filters.value, data.filters)
  }

  return {
    projects,
    tags,
    filters,
    snapshot,
    restoreSnapshot,
    applyImport,
    addFilter,
    updateFilter,
    removeFilter,
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
