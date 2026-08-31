import { defineStore } from 'pinia'
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { loadTasks, migrateFromLocalStorage, saveTasks } from '@/db'
import type { Priority, Recurrence, StoredTask } from '@/db/schema'
import { createTask, groupByParent } from '@/domain/task'
import { nextOccurrence } from '@/domain/recurrence'
import { nextOrder, orderBetween, sortByOrder } from '@/domain/ordering'
import { countByFilter, queryTasks, type TaskFilter, type TaskQuery } from '@/domain/filtering'
import { overdueCount, resolveView, viewCount, type TaskGroup, type ViewSpec } from '@/domain/views'
import { useHistoryStore } from './history'
import { useCollectionsStore } from './collections'
import { useUiStore } from './ui'

/**
 * 任務本體。
 *
 * 這個 store 只管任務：專案與標籤在 collections、復原在 history、
 * 搜尋與主題偏好在 ui。先前全部擠在一個 450 行的 store 裡，
 * 任何一項改動都得碰同一個檔案。
 *
 * 篩選與排序都委派給 domain 的純函式，這裡只做狀態編排與持久化。
 */
export const useTasksStore = defineStore('tasks', () => {
  const items = ref<StoredTask[]>([])

  /** 資料由 IndexedDB 非同步載入，載入期間畫面需要能表達「還在讀」。 */
  const isLoading = ref(true)
  /** 載入失敗：清單真的取不到，畫面應改為錯誤狀態。 */
  const loadError = ref<unknown>(null)
  /**
   * 寫入失敗：資料仍在記憶體、清單照常可用，只是沒存下去。
   * 刻意與 loadError 分開——混為一談會讓一次存檔失敗就整份清單消失。
   */
  const writeError = ref<unknown>(null)
  const migration = ref<{ migrated: number; skipped: number } | null>(null)

  const history = useHistoryStore()
  const collections = useCollectionsStore()
  const ui = useUiStore()

  // ------------------------------------------------------------ 查詢

  /** 目前搜尋條件下的可見任務，供畫面與計數共用同一條路徑。 */
  const visible = computed(() => (filter: TaskFilter) =>
    queryTasks(items.value, { keyword: ui.keyword, filter }),
  )

  const counts = computed(() => countByFilter(items.value, { keyword: ui.keyword }))

  /**
   * 檢視的分組結果。清單本體與側邊欄徽章都走這條路徑（domain/views），
   * 沿用「一條路徑」的規矩——數字與內容不可能對不上。
   */
  const groupsOf = computed(
    () =>
      (spec: ViewSpec): TaskGroup[] =>
        resolveView(items.value, spec, { keyword: ui.keyword }),
  )

  /** 側邊欄徽章：刻意不套關鍵字，搜尋中仍要看得到各入口的真實數量。 */
  const countOf = computed(
    () =>
      (spec: ViewSpec): number =>
        viewCount(items.value, spec),
  )

  const overdue = computed(() => overdueCount(items.value))

  /**
   * 子任務索引：parentId → 依序排好的子項。
   *
   * 一次算好整張表而不是每列各自 filter：清單有 N 列時，後者是 N² 次掃描。
   */
  const childrenByParent = computed(() => groupByParent(items.value))

  function childrenOf(parentId: string): StoredTask[] {
    return childrenByParent.value.get(parentId) ?? []
  }

  const remaining = computed(() => items.value.filter((t) => !t.isCompleted).length)

  function query(q: TaskQuery = {}): StoredTask[] {
    return queryTasks(items.value, { keyword: ui.keyword, ...q })
  }

  // ------------------------------------------------------------ 持久化

  let inFlight: Promise<void> | null = null
  let dirty = false
  /** 載入期間為 true；watcher 是非同步的，不能只靠 isLoading 判斷。 */
  let hydrating = false

  function snapshot(): StoredTask[] {
    return toRaw(items.value).map((t) => ({ ...toRaw(t), tagIds: [...t.tagIds] }))
  }

  /**
   * 回傳的 Promise 一定在資料真的寫完時才 resolve，即使呼叫時已有寫入在進行中。
   * 不做延遲防抖：那會讓「操作後立刻重新整理」出現丟資料的空窗。
   */
  function flush(): Promise<void> {
    if (inFlight) {
      dirty = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          dirty = false
          await saveTasks(snapshot())
          await collections.flush()
        } while (dirty)
        writeError.value = null
      } catch (error) {
        writeError.value = error
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function init(): Promise<void> {
    hydrating = true
    isLoading.value = true
    loadError.value = null
    try {
      const result = await migrateFromLocalStorage()
      if (result.ran) migration.value = { migrated: result.migrated, skipped: result.skipped }
      items.value = await loadTasks()
      await collections.load()
    } catch (error) {
      loadError.value = error
    } finally {
      isLoading.value = false
    }
    // watcher 以 pre flush 非同步執行；等它跑過這一輪再解除保護，
    // 否則載入本身會觸發一次多餘的回寫。
    await nextTick()
    hydrating = false
  }

  watch(
    [items, () => collections.projects, () => collections.tags],
    () => {
      if (hydrating) return
      void flush()
    },
    { deep: true },
  )

  // ---------------------------------------------------------- 任務 CRUD

  const indexOf = (id: string) => items.value.findIndex((t) => t.id === id)

  function add(taskName: string, overrides: Partial<StoredTask> = {}): StoredTask {
    const task = createTask(taskName, nextOrder(items.value), overrides)
    items.value.push(task)
    history.record({
      label: `新增「${taskName}」`,
      undo: () => {
        items.value = items.value.filter((t) => t.id !== task.id)
      },
      redo: () => {
        items.value.push(task)
      },
    })
    return task
  }

  /**
   * 新增子任務。
   *
   * 只支援一層：父項本身有 parentId 時直接拒絕。無限層級對待辦工具是過度設計，
   * 而且會帶來循環參照的風險（domain/task.ts 的 groupByParent 也是照這個前提寫的）。
   * 子項預設繼承父項的專案——分類是父項的屬性，子項另外分類只會讓清單更難讀。
   */
  function addSubtask(parentId: string, taskName: string): StoredTask | null {
    const parent = items.value.find((t) => t.id === parentId)
    if (!parent || parent.parentId !== null) return null

    const task = createTask(taskName, nextOrder(childrenOf(parentId)), {
      parentId,
      projectId: parent.projectId,
    })
    items.value.push(task)
    history.record({
      label: `新增子任務「${taskName}」`,
      undo: () => {
        items.value = items.value.filter((t) => t.id !== task.id)
      },
      redo: () => {
        items.value.push(task)
      },
    })
    return task
  }

  function update(id: string, patch: Partial<StoredTask>): void {
    const index = indexOf(id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredTask) }
    const after = { ...before, ...patch, updatedAt: Date.now() }
    items.value[index] = after
    history.record({
      label: `修改「${before.taskName}」`,
      undo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  /** 刪除任務，連同其子任務。 */
  function remove(id: string): void {
    const target = items.value.find((t) => t.id === id)
    if (!target) return
    const removed = items.value.filter((t) => t.id === id || t.parentId === id).map((t) => ({ ...t }))
    items.value = items.value.filter((t) => t.id !== id && t.parentId !== id)
    history.record({
      label:
        removed.length > 1
          ? `刪除「${target.taskName}」與 ${removed.length - 1} 個子項`
          : `刪除「${target.taskName}」`,
      undo: () => {
        items.value = sortByOrder([...items.value, ...removed])
      },
      redo: () => {
        items.value = items.value.filter((t) => t.id !== id && t.parentId !== id)
      },
    })
  }

  function clearCompleted(): void {
    const removed = items.value.filter((t) => t.isCompleted).map((t) => ({ ...t }))
    if (removed.length === 0) return
    items.value = items.value.filter((t) => !t.isCompleted)
    history.record({
      label: `清除 ${removed.length} 項已完成`,
      undo: () => {
        items.value = sortByOrder([...items.value, ...removed])
      },
      redo: () => {
        items.value = items.value.filter((t) => !t.isCompleted)
      },
    })
  }

  /**
   * 切換完成狀態。
   *
   * 重複性任務在「完成」時不是消失，而是把到期日推進到下一次發生日並保持未完成——
   * 這就是「完成時才展開」，不預先產生無限筆。
   * 規則結束（超過 until 或 count 用盡）時才真正標記完成。
   */
  function toggle(id: string): void {
    const index = indexOf(id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredTask) }

    if (!before.isCompleted && before.recurrence && before.dueDate) {
      const next = nextOccurrence(before.recurrence, before.dueDate)
      if (next !== null) {
        const advanced = { ...before, dueDate: next, updatedAt: Date.now() }
        items.value[index] = advanced
        history.record({
          label: `完成「${before.taskName}」，下次 ${next}`,
          undo: () => {
            const i = indexOf(id)
            if (i !== -1) items.value[i] = before
          },
          redo: () => {
            const i = indexOf(id)
            if (i !== -1) items.value[i] = advanced
          },
        })
        return
      }
    }

    const now = Date.now()
    const after = {
      ...before,
      isCompleted: !before.isCompleted,
      completedAt: before.isCompleted ? null : now,
      updatedAt: now,
    }
    items.value[index] = after
    history.record({
      label: `${after.isCompleted ? '完成' : '取消完成'}「${before.taskName}」`,
      undo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  function setAllCompleted(value: boolean): void {
    const before = items.value.map((t) => ({ ...t }))
    const now = Date.now()
    for (const task of items.value) {
      task.isCompleted = value
      task.completedAt = value ? now : null
      task.updatedAt = now
    }
    history.record({
      label: value ? '全部標記為完成' : '全部取消完成',
      undo: () => {
        items.value = before
      },
    })
  }

  /** 拖曳／鍵盤排序：把 id 移到 targetId 之前或之後。 */
  function move(id: string, targetId: string, position: 'before' | 'after'): void {
    const moving = items.value.find((t) => t.id === id)
    const target = items.value.find((t) => t.id === targetId)
    if (!moving || !target || id === targetId) return

    const sorted = sortByOrder(items.value)
    const targetIndex = sorted.findIndex((t) => t.id === targetId)
    const neighbour = sorted[position === 'before' ? targetIndex - 1 : targetIndex + 1] ?? null

    const previousOrder = moving.order
    // 取中間值而非重編號：一次拖曳只需寫入一列
    moving.order =
      position === 'before'
        ? orderBetween(neighbour?.order ?? null, target.order)
        : orderBetween(target.order, neighbour?.order ?? null)
    moving.updatedAt = Date.now()

    history.record({
      label: `移動「${moving.taskName}」`,
      undo: () => {
        const t = items.value.find((x) => x.id === id)
        if (t) t.order = previousOrder
      },
    })
  }

  function setPriority(id: string, priority: Priority): void {
    update(id, { priority })
  }

  /**
   * 改期。清掉日期時一併清掉時間——沒有日期的時間沒有意義，
   * 這條規則在 normalizeTask 與 quickAdd 都成立，這裡不能是例外。
   */
  function reschedule(id: string, dueDate: string | null): void {
    update(id, dueDate === null ? { dueDate: null, dueTime: null } : { dueDate })
  }

  function setRecurrence(id: string, recurrence: Recurrence | null): void {
    update(id, { recurrence })
  }

  function toggleTag(taskId: string, tagId: string): void {
    const task = items.value.find((t) => t.id === taskId)
    if (!task) return
    update(taskId, {
      tagIds: task.tagIds.includes(tagId)
        ? task.tagIds.filter((t) => t !== tagId)
        : [...task.tagIds, tagId],
    })
  }

  // -------------------------------------------- 跨 store 的關聯處理

  /**
   * 刪除專案。
   *
   * 預設把底下的任務移到「未分類」而不是一併刪除——刪專案是組織動作，
   * 不該把使用者的工作內容一起帶走。要連任務一起刪必須明確指定。
   *
   * 這個動作橫跨兩個 store，放在任務這邊：它知道任務，collections 不需要知道。
   */
  function removeProject(id: string, options: { deleteTasks?: boolean } = {}): void {
    const project = collections.removeProject(id)
    if (!project) return

    const affected = items.value.filter((t) => t.projectId === id).map((t) => ({ ...t }))
    if (options.deleteTasks) {
      items.value = items.value.filter((t) => t.projectId !== id)
    } else {
      for (const task of items.value) {
        if (task.projectId === id) task.projectId = null
      }
    }

    history.record({
      label: options.deleteTasks
        ? `刪除專案「${project.name}」與 ${affected.length} 項任務`
        : `刪除專案「${project.name}」，${affected.length} 項移至未分類`,
      undo: () => {
        collections.restoreProject(project)
        if (options.deleteTasks) {
          items.value = sortByOrder([...items.value, ...affected])
        } else {
          const ids = new Set(affected.map((a) => a.id))
          for (const task of items.value) {
            if (ids.has(task.id)) task.projectId = id
          }
        }
      },
    })
  }

  /** 刪除標籤時一併從所有任務身上移除，避免留下指向不存在標籤的 id。 */
  function removeTag(id: string): void {
    const tag = collections.removeTag(id)
    if (!tag) return

    const affected = new Set(items.value.filter((t) => t.tagIds.includes(id)).map((t) => t.id))
    for (const task of items.value) {
      if (task.tagIds.includes(id)) task.tagIds = task.tagIds.filter((t) => t !== id)
    }

    history.record({
      label: `刪除標籤「${tag.name}」`,
      undo: () => {
        collections.restoreTag(tag)
        for (const task of items.value) {
          if (affected.has(task.id)) task.tagIds = [...task.tagIds, id]
        }
      },
    })
  }

  return {
    items,
    isLoading,
    loadError,
    writeError,
    migration,
    visible,
    counts,
    groupsOf,
    countOf,
    overdue,
    remaining,
    query,
    childrenOf,
    init,
    flush,
    add,
    addSubtask,
    update,
    remove,
    clearCompleted,
    toggle,
    setAllCompleted,
    move,
    setPriority,
    reschedule,
    setRecurrence,
    toggleTag,
    removeProject,
    removeTag,
  }
})
