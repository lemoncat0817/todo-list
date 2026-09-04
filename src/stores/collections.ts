import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadFilters, loadProjects, loadTags, saveFilters, saveProjects, saveTags } from '@/db'
import {
  DEFAULT_FILTER_COLOR,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  type StoredFilter,
  type StoredProject,
  type StoredTag,
} from '@/db/schema'
import { findByNormalizedName } from '@/domain/filtering'
import { compareRankValues, nextRank } from '@/domain/rank'
import { inCurrentWorkspace } from '@/domain/workspaceScope'
import { isSyncConfigured } from '@/sync/config'
import { toRemoteFilter, toRemoteProject, toRemoteTag } from '@/sync/rowMapping'
import { useHistoryStore } from './history'
import { useWorkspaceStore } from './workspace'
import { enqueueCollectionOps } from './outboxSync'

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
  const workspace = useWorkspaceStore()

  /**
   * 排除收件匣、且屬於目前所在工作區的專案清單，給所有「使用者看得到、
   * 挑得到」的畫面用（側邊欄、專案選單、搜尋、篩選器解析……）。
   * `projects` 本身維持原始全量——本地持久化與同步都得原封不動地存取
   * 每個工作區的每一筆專案（含收件匣），只有 UI 層要依目前脈絡收窄。
   */
  const visibleProjects = computed(() =>
    projects.value.filter((p) => !p.isInbox && inCurrentWorkspace(p, workspace.currentWorkspaceId)),
  )
  /**
   * 跟 visibleProjects 幾乎一樣，差別是不排除收件匣——只給重名檢查用：
   * 使用者在自己工作區底下新建一個叫「收件匣」的專案一樣要被擋，
   * 但 visibleProjects 特意把收件匣藏起來，不能拿來做這個比對。
   */
  const projectsInCurrentWorkspace = computed(() =>
    projects.value.filter((p) => inCurrentWorkspace(p, workspace.currentWorkspaceId)),
  )
  /** `resolveView`／`matchesView` 用來把「專案是收件匣」跟「沒有專案」視為同一件事。 */
  const inboxProjectIds = computed(
    () => new Set(projects.value.filter((p) => p.isInbox).map((p) => p.id)),
  )
  /**
   * 目前所在工作區的收件匣 id。stores/tasks.ts 的 add() 在沒指定專案時
   * 落到這裡，而不是 projectId: null——伺服器 derive_task_workspace()
   * 遇到 null 會把任務寫進「建立者自己的個人工作區」（見 0004），受邀
   * 成員在共享工作區新增未分類任務，同步回來就會從畫面上消失。
   *
   * 純本機／尚未登入時 currentWorkspaceId 是 null，這裡也回 null，add()
   * 維持原本的未分類語意。
   */
  const currentInboxId = computed(() => {
    const workspaceId = workspace.currentWorkspaceId
    if (workspaceId === null) return null
    return projects.value.find((p) => p.isInbox && p.workspaceId === workspaceId)?.id ?? null
  })
  /** 理由同 visibleProjects：標籤／篩選器也是依工作區分的容器（見 0005_rls.sql 的說明）。 */
  const visibleTags = computed(() =>
    tags.value.filter((t) => inCurrentWorkspace(t, workspace.currentWorkspaceId)),
  )
  const visibleFilters = computed(() =>
    filters.value.filter((f) => inCurrentWorkspace(f, workspace.currentWorkspaceId)),
  )

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

  /** 匯入時需復活的 id 集合，下一次 flush() 傳給 enqueueCollectionOps 清除遠端墓碑。 */
  let reviveProjectIds = new Set<string>()
  let reviveTagIds = new Set<string>()
  let reviveFilterIds = new Set<string>()

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
        reviveProjectIds,
      )
      persistedTagsIndex = await enqueueCollectionOps(
        'tag',
        tags.value,
        persistedTagsIndex,
        toRemoteTag,
        remoteMergedIds,
        reviveTagIds,
      )
      persistedFiltersIndex = await enqueueCollectionOps(
        'filter',
        filters.value,
        persistedFiltersIndex,
        toRemoteFilter,
        remoteMergedIds,
        reviveFilterIds,
      )
      remoteMergedIds = new Set()
      reviveProjectIds = new Set()
      reviveTagIds = new Set()
      reviveFilterIds = new Set()
    }
  }

  // ------------------------------------------------------------- 專案

  /**
   * 建立前先找同名（忽略大小寫／全形半形）專案——UI 端已經會擋掉這個情形並提示使用者，
   * 這裡是最後一道防線：即使呼叫端漏擋，也不會因此產生兩個同名專案。
   * 找到既有的就直接回傳它，不新增、不記錄復原（因為根本沒有變動發生）。
   *
   * 重名比對只看目前所在工作區：工作區 A 的「工作」跟工作區 B 的「工作」
   * 是兩個不相干的專案，不能因為同名就把使用者導去另一個工作區的專案。
   */
  function addProject(name: string, color = DEFAULT_PROJECT_COLOR): StoredProject {
    const existing = findByNormalizedName(projectsInCurrentWorkspace.value, name)
    if (existing) return existing
    const project: StoredProject = {
      id: crypto.randomUUID(),
      name,
      color,
      rank: nextRank(projects.value),
      updatedAt: Date.now(),
      isInbox: false,
      // 新建立的專案落在使用者目前所在的工作區——這是在共享工作區底下
      // 建立專案唯一的路徑（見 sync/rowMapping.ts 的 toRemoteProject 註解）。
      // currentWorkspaceId 在沒有設定同步／尚未登入時是 null，此時純本機
      // 模式下建立的專案本來就沒有工作區可言。
      workspaceId: workspace.currentWorkspaceId,
    }
    if (!workspace.canManageProjects) return project
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
    if (!workspace.canManageProjects) return
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
    if (!workspace.canManageProjects) return null
    const project = projects.value.find((p) => p.id === id) ?? null
    if (!project) return null
    projects.value = projects.value.filter((p) => p.id !== id)
    return project
  }

  function restoreProject(project: StoredProject): void {
    reviveProjectIds.add(project.id)
    projects.value = [...projects.value, project].sort((a, b) => compareRankValues(a.rank, b.rank))
  }

  // ------------------------------------------------------------- 標籤

  /**
   * 同 addProject：先找同名標籤，找到就重用既有的，不建立重複項目；
   * 重名比對一樣只看目前所在工作區。
   */
  function addTag(name: string, color = DEFAULT_TAG_COLOR): StoredTag {
    const existingTag = findByNormalizedName(visibleTags.value, name)
    if (existingTag) return existingTag
    const tag: StoredTag = {
      id: crypto.randomUUID(),
      name,
      color,
      updatedAt: Date.now(),
      workspaceId: workspace.currentWorkspaceId,
    }
    if (!workspace.canWriteCollections) return tag
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
    if (!workspace.canWriteCollections) return
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
    if (!workspace.canWriteCollections) return null
    const tag = tags.value.find((t) => t.id === id) ?? null
    if (!tag) return null
    tags.value = tags.value.filter((t) => t.id !== id)
    return tag
  }

  function restoreTag(tag: StoredTag): void {
    reviveTagIds.add(tag.id)
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
      rank: nextRank(filters.value),
      updatedAt: Date.now(),
      workspaceId: workspace.currentWorkspaceId,
    }
    if (!workspace.canWriteCollections) return filter
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
    if (!workspace.canWriteCollections) return
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
    if (!workspace.canWriteCollections) return
    const filter = filters.value.find((f) => f.id === id)
    if (!filter) return
    filters.value = filters.value.filter((f) => f.id !== id)
    history.record({
      label: `刪除篩選器「${filter.name}」`,
      undo: () => {
        reviveFilterIds.add(filter.id)
        filters.value = [...filters.value, filter].sort((a, b) => compareRankValues(a.rank, b.rank))
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
    for (const p of snap.projects) reviveProjectIds.add(p.id)
    for (const t of snap.tags) reviveTagIds.add(t.id)
    for (const f of snap.filters) reviveFilterIds.add(f.id)
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
    // 匯出範圍改成只含目前工作區（見 DataDialog.vue 的 exportBackup()）
    // 之後，「取代」不能再是清空全部——那會連別的工作區在本機的快取也
    // 一起清掉，使用者看到的卻是「我只是匯入了 A 工作區的備份」。
    // 取代的語意收斂成「取代目前工作區的部分，其餘工作區原封不動」。
    const merge = <T extends { id: string; workspaceId: string | null }>(
      existing: T[],
      incoming: readonly T[],
    ): T[] => {
      if (mode === 'replace') {
        const outsideCurrentWorkspace = existing.filter(
          (item) => !inCurrentWorkspace(item, workspace.currentWorkspaceId),
        )
        return [...outsideCurrentWorkspace, ...incoming]
      }
      const byId = new Map(existing.map((item) => [item.id, item]))
      for (const item of incoming) byId.set(item.id, item)
      return [...byId.values()]
    }

    const mergeProjects = (
      existing: StoredProject[],
      incoming: readonly StoredProject[],
    ): StoredProject[] => {
      if (mode === 'replace') {
        const outsideCurrentWorkspace = existing.filter(
          (item) => !inCurrentWorkspace(item, workspace.currentWorkspaceId),
        )
        // 收件匣專案在伺服器端一個工作區僅有一個，取代模式不能將當前工作區原本的收件匣專案抹除
        const currentInbox = existing.find(
          (p) => p.workspaceId === workspace.currentWorkspaceId && p.isInbox,
        )
        const preserved =
          currentInbox && !incoming.some((p) => p.id === currentInbox.id) ? [currentInbox] : []
        return [...outsideCurrentWorkspace, ...preserved, ...incoming]
      }
      const byId = new Map(existing.map((item) => [item.id, item]))
      for (const item of incoming) byId.set(item.id, item)
      return [...byId.values()]
    }

    for (const p of data.projects) reviveProjectIds.add(p.id)
    for (const t of data.tags) reviveTagIds.add(t.id)
    for (const f of data.filters) reviveFilterIds.add(f.id)

    projects.value = mergeProjects(projects.value, data.projects)
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
    visibleProjects,
    projectsInCurrentWorkspace,
    inboxProjectIds,
    currentInboxId,
    tags,
    visibleTags,
    filters,
    visibleFilters,
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
