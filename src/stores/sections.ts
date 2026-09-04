import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { loadSections, saveSections } from '@/db'
import type { StoredSection } from '@/db/schema'
import { between, compareRankValues, nextRank, withJitter } from '@/domain/rank'
import { isSyncConfigured } from '@/sync/config'
import { toRemoteSection } from '@/sync/rowMapping'
import { useHistoryStore } from './history'
import { useWorkspaceStore } from './workspace'
import { enqueueCollectionOps } from './outboxSync'

/**
 * 區段（Section，M5）——專案內的分組，也是看板檢視的欄。獨立成一個
 * store 而不是塞進 collections.ts：區段依附於單一專案（projects/tags/
 * filters 是整個工作區共用的集合），生命週期跟可見範圍規則都不一樣，
 * 混在一起會讓 collections.ts 的「工作區集合」語意變得含糊。
 *
 * 不檢查同名——跟 filters 一樣（不像 projects/tags 會重用同名項目）：
 * 看板欄位常常就是「待處理」「進行中」這種簡單標籤，禁止重複沒有實質
 * 好處，只會讓使用者在真的想要兩個同名欄位時卡關。
 */
export const useSectionsStore = defineStore('sections', () => {
  const items = ref<StoredSection[]>([])
  const history = useHistoryStore()
  const workspace = useWorkspaceStore()

  function forProject(projectId: string): StoredSection[] {
    return items.value.filter((s) => s.projectId === projectId).sort((a, b) => compareRankValues(a.rank, b.rank))
  }

  let persistedIndex = new Map<string, string>()
  let remoteMergedIds = new Set<string>()
  let reviveSectionIds = new Set<string>()

  async function load(): Promise<void> {
    items.value = await loadSections()
    persistedIndex = new Map(items.value.map((s) => [s.id, JSON.stringify(s)]))
  }

  /** toRaw：跟 comments.ts 的 snapshot() 同一個坑，put() 認不得 reactive Proxy。 */
  function snapshot(): StoredSection[] {
    return items.value.map((s) => ({ ...toRaw(s) }))
  }

  async function flush(): Promise<void> {
    const rows = snapshot()
    await saveSections(rows)
    if (isSyncConfigured) {
      persistedIndex = await enqueueCollectionOps(
        'section',
        rows,
        persistedIndex,
        toRemoteSection,
        remoteMergedIds,
        reviveSectionIds,
      )
      remoteMergedIds = new Set()
      reviveSectionIds = new Set()
    }
  }

  function addSection(projectId: string, name: string): StoredSection {
    const section: StoredSection = {
      id: crypto.randomUUID(),
      projectId,
      name,
      rank: nextRank(items.value.filter((s) => s.projectId === projectId)),
      updatedAt: Date.now(),
    }
    if (!workspace.canWriteTasks) return section
    items.value.push(section)
    history.record({
      label: `新增區段「${name}」`,
      undo: () => {
        items.value = items.value.filter((s) => s.id !== section.id)
      },
      redo: () => {
        items.value.push(section)
      },
    })
    return section
  }

  function renameSection(id: string, name: string): void {
    if (!workspace.canWriteTasks) return
    const index = items.value.findIndex((s) => s.id === id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredSection) }
    const after = { ...before, name, updatedAt: Date.now() }
    items.value[index] = after
    history.record({
      label: `重新命名區段「${before.name}」`,
      undo: () => {
        const i = items.value.findIndex((s) => s.id === id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = items.value.findIndex((s) => s.id === id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  /** 拖曳排序看板欄本身——跟 domain/rank.ts 的 between()/withJitter() 同一套邏輯，比照 stores/tasks.ts 的 move()。 */
  function moveSection(id: string, targetId: string, position: 'before' | 'after'): void {
    if (!workspace.canWriteTasks) return
    const moving = items.value.find((s) => s.id === id)
    const target = items.value.find((s) => s.id === targetId)
    if (!moving || !target || id === targetId || moving.projectId !== target.projectId) return

    const siblings = forProject(moving.projectId).filter((s) => s.id !== id)
    const targetIndex = siblings.findIndex((s) => s.id === targetId)
    const neighbour = siblings[position === 'before' ? targetIndex - 1 : targetIndex + 1] ?? null

    const previousRank = moving.rank
    try {
      moving.rank = withJitter(
        position === 'before' ? between(neighbour?.rank ?? null, target.rank) : between(target.rank, neighbour?.rank ?? null),
      )
    } catch {
      return
    }
    moving.updatedAt = Date.now()

    history.record({
      label: `移動區段「${moving.name}」`,
      undo: () => {
        const s = items.value.find((x) => x.id === id)
        if (s) s.rank = previousRank
      },
    })
  }

  /**
   * 拿掉一個區段——不記錄復原（呼叫端 stores/tasks.ts 的 removeSection()
   * 才是使用者看到的那個「刪除」動作，這裡只是原始的移除，跟
   * collections.ts 的 removeProject() 同一種分工）。
   */
  function removeSection(id: string): StoredSection | null {
    if (!workspace.canWriteTasks) return null
    const section = items.value.find((s) => s.id === id) ?? null
    if (!section) return null
    items.value = items.value.filter((s) => s.id !== id)
    return section
  }

  function restoreSection(section: StoredSection): void {
    reviveSectionIds.add(section.id)
    items.value = [...items.value, section].sort((a, b) => compareRankValues(a.rank, b.rank))
  }

  function mergeRemote(rows: readonly StoredSection[]): void {
    remoteMergedIds = new Set([...remoteMergedIds, ...items.value.map((s) => s.id), ...rows.map((s) => s.id)])
    items.value = [...rows]
  }

  return {
    items,
    forProject,
    load,
    flush,
    addSection,
    renameSection,
    moveSection,
    removeSection,
    restoreSection,
    mergeRemote,
  }
})
