import { defineStore } from 'pinia'
import { ref } from 'vue'
import { enqueueOp, loadFilters, loadProjects, loadTags, saveFilters, saveProjects, saveTags } from '@/db'
import {
  DEFAULT_FILTER_COLOR,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  type Op,
  type OpKind,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
} from '@/db/schema'
import { diffAgainstFingerprint, diffFields } from '@/domain/diff'
import { findByNormalizedName } from '@/domain/filtering'
import { nextOrder } from '@/domain/ordering'
import { isSyncConfigured } from '@/sync/config'
import { toRemoteFilter, toRemoteProject, toRemoteTag } from '@/sync/rowMapping'
import { useHistoryStore } from './history'

/**
 * 跟 stores/tasks.ts 的 enqueueSyncOps 同一套邏輯，套用在
 * projects/tags/filters 上——三者形狀不同但規則相同，寫一支泛型函式
 * 而不是各寫一份。`kind` 決定 op 的種類前綴（project／tag／filter），
 * `toRemote` 是各自的欄位對應（sync/rowMapping.ts）。
 *
 * 這裡只算「要排哪些 op」，不動本地寫入——collections.ts 的本地寫入
 * （saveProjects 等）維持整份覆寫，量小到不值得為此另外做逐列指紋；
 * `previousIndex` 純粹是為了推導遠端補丁而存在的另一份帳，跟本地
 * IndexedDB 寫不寫得有效率無關。
 */
async function enqueueCollectionOps<T extends { id: string; updatedAt: number }>(
  kind: 'project' | 'tag' | 'filter',
  current: readonly T[],
  previousIndex: ReadonlyMap<string, string>,
  toRemote: (row: T) => Record<string, unknown>,
  excludeIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const { upserts, deletes, nextFingerprint } = diffAgainstFingerprint(current, previousIndex)
  const now = Date.now()
  const ops: Op[] = []

  for (const row of upserts) {
    if (excludeIds.has(row.id)) continue
    const previousJson = previousIndex.get(row.id)
    const before = previousJson ? toRemote(JSON.parse(previousJson) as T) : null
    const patch = diffFields(before, toRemote(row))
    if (Object.keys(patch).length === 0) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: `${kind}.${before === null ? 'create' : 'patch'}` as OpKind,
      targetId: row.id,
      payload: patch,
      createdAt: now,
      attempts: 0,
    })
  }

  for (const id of deletes) {
    if (excludeIds.has(id)) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: `${kind}.delete` as OpKind,
      targetId: id,
      payload: { deleted_at: now },
      createdAt: now,
      attempts: 0,
    })
  }

  for (const op of ops) await enqueueOp(op)
  return nextFingerprint
}

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

  /** 純粹用來推導 outbox 補丁的內容指紋，跟本地 IndexedDB 寫入無關（見上方 enqueueCollectionOps 的說明）。 */
  let persistedProjectsIndex = new Map<string, string>()
  let persistedTagsIndex = new Map<string, string>()
  let persistedFiltersIndex = new Map<string, string>()
  /** mergeRemote() 這次動到的 id，下一次 flush() 消費後清空——理由跟 stores/tasks.ts 的 remoteMergedIds 一致。 */
  let remoteMergedIds = new Set<string>()

  async function load(): Promise<void> {
    projects.value = await loadProjects()
    tags.value = await loadTags()
    filters.value = await loadFilters()
    // 剛讀進來的內容就是「已經跟本地一致」的基準，否則第一次 flush()
    // 會把每一列都當成新的而排一整批 create op。
    persistedProjectsIndex = new Map(projects.value.map((p) => [p.id, JSON.stringify(p)]))
    persistedTagsIndex = new Map(tags.value.map((t) => [t.id, JSON.stringify(t)]))
    persistedFiltersIndex = new Map(filters.value.map((f) => [f.id, JSON.stringify(f)]))
  }

  async function flush(): Promise<void> {
    await saveProjects(projects.value.map((p) => ({ ...p })))
    await saveTags(tags.value.map((t) => ({ ...t })))
    await saveFilters(filters.value.map((f) => ({ ...f })))

    if (isSyncConfigured) {
      persistedProjectsIndex = await enqueueCollectionOps(
        'project',
        projects.value,
        persistedProjectsIndex,
        toRemoteProject,
        remoteMergedIds,
      )
      persistedTagsIndex = await enqueueCollectionOps('tag', tags.value, persistedTagsIndex, toRemoteTag, remoteMergedIds)
      persistedFiltersIndex = await enqueueCollectionOps(
        'filter',
        filters.value,
        persistedFiltersIndex,
        toRemoteFilter,
        remoteMergedIds,
      )
      remoteMergedIds = new Set()
    }
  }

  // ------------------------------------------------------------- 專案

  /**
   * 建立前先找同名（忽略大小寫／全形半形）專案——UI 端已經會擋掉這個情形並提示使用者，
   * 這裡是最後一道防線：即使呼叫端漏擋，也不會因此產生兩個同名專案。
   * 找到既有的就直接回傳它，不新增、不記錄復原（因為根本沒有變動發生）。
   */
  function addProject(name: string, color = DEFAULT_PROJECT_COLOR): StoredProject {
    const existing = findByNormalizedName(projects.value, name)
    if (existing) return existing
    const project: StoredProject = {
      id: crypto.randomUUID(),
      name,
      color,
      order: nextOrder(projects.value),
      updatedAt: Date.now(),
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
    const after = { ...before, ...patch, updatedAt: Date.now() }
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

  /** 同 addProject：先找同名標籤，找到就重用既有的，不建立重複項目。 */
  function addTag(name: string, color = DEFAULT_TAG_COLOR): StoredTag {
    const existingTag = findByNormalizedName(tags.value, name)
    if (existingTag) return existingTag
    const tag: StoredTag = { id: crypto.randomUUID(), name, color, updatedAt: Date.now() }
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
    const after = { ...before, ...patch, updatedAt: Date.now() }
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
      updatedAt: Date.now(),
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
    const after = { ...before, ...patch, updatedAt: Date.now() }
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

  /**
   * 套用跨裝置同步的合併結果，三份一起換掉。
   * 同樣不經過 history.record，理由跟 stores/tasks.ts 的 mergeRemote 一致。
   */
  function mergeRemote(data: {
    projects: readonly StoredProject[]
    tags: readonly StoredTag[]
    filters: readonly StoredFilter[]
  }): void {
    // 聯集合併前後的 id（含遠端刪除的），下一次 flush() 靠這份集合排除
    // 剛從遠端合併回來的資料，不誤判成本地變更又推一次回去——理由跟
    // stores/tasks.ts 的 mergeRemote／remoteMergedIds 完全一致。用聯集
    // 而不是直接覆蓋：mergeRemote 理論上可能在同一次 flush() 之前被呼叫
    // 超過一次（例如 tasks／projects／tags／filters 各自一輪拉取都命中）。
    remoteMergedIds = new Set([
      ...remoteMergedIds,
      ...projects.value.map((p) => p.id),
      ...data.projects.map((p) => p.id),
      ...tags.value.map((t) => t.id),
      ...data.tags.map((t) => t.id),
      ...filters.value.map((f) => f.id),
      ...data.filters.map((f) => f.id),
    ])
    projects.value = [...data.projects]
    tags.value = [...data.tags]
    filters.value = [...data.filters]
  }

  return {
    projects,
    tags,
    filters,
    snapshot,
    restoreSnapshot,
    applyImport,
    mergeRemote,
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
