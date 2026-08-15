import { defineStore } from 'pinia'
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import {
  loadProjects,
  loadTags,
  loadTasks,
  migrateFromLocalStorage,
  nextOrder,
  orderBetween,
  saveProjects,
  saveTags,
  saveTasks,
} from '@/db'
import type { Priority, Recurrence, StoredProject, StoredTag, StoredTask } from '@/db/schema'
import { createTask } from '@/domain/task'
import { nextOccurrence } from '@/domain/recurrence'
import { UndoStack, type UndoableCommand } from '@/domain/undo'
import { sanitizeUiPrefs } from './sanitize'

export const useTodoTaskStore = defineStore(
  'todoTask',
  () => {
    const todoList = ref<StoredTask[]>([])
    const projects = ref<StoredProject[]>([])
    const tags = ref<StoredTag[]>([])

    const isSearch = ref(false)
    const keyword = ref('')

    /** 資料由 IndexedDB 非同步載入，載入期間畫面需要能表達「還在讀」。 */
    const isLoading = ref(true)
    /** 載入失敗：清單真的取不到，畫面應改為錯誤狀態。 */
    const loadError = ref<unknown>(null)
    /**
     * 寫入失敗：資料仍在記憶體裡、清單照常可用，只是沒存下去。
     * 刻意與 loadError 分開——把兩者混為一談會讓一次存檔失敗就整份清單消失。
     */
    const writeError = ref<unknown>(null)
    const migration = ref<{ migrated: number; skipped: number } | null>(null)

    /** 最近一次操作的提示，供畫面顯示可復原訊息。 */
    const lastAction = ref<string | null>(null)
    const undoStack = new UndoStack({ limit: 50 })
    const undoDepth = ref(0)
    const canUndo = computed(() => undoDepth.value > 0)

    // ------------------------------------------------------------ 持久化

    let inFlight: Promise<void> | null = null
    let dirty = false
    /** 載入期間為 true；watcher 是非同步的，不能只靠 isLoading 判斷。 */
    let hydrating = false

    function snapshotTasks(): StoredTask[] {
      return toRaw(todoList.value).map((t) => ({ ...toRaw(t), tagIds: [...t.tagIds] }))
    }

    /**
     * 回傳的 Promise 一定在「資料真的寫完」時才 resolve，
     * 即使呼叫時已有寫入在進行中也一樣——否則呼叫端無法確知何時安全。
     * 不做延遲防抖：那會讓「操作後立刻重新整理」有丟資料的空窗。
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
            await saveTasks(snapshotTasks())
            await saveProjects(toRaw(projects.value).map((p) => ({ ...toRaw(p) })))
            await saveTags(toRaw(tags.value).map((t) => ({ ...toRaw(t) })))
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
        if (result.ran) {
          migration.value = { migrated: result.migrated, skipped: result.skipped }
        }
        todoList.value = await loadTasks()
        projects.value = await loadProjects()
        tags.value = await loadTags()
      } catch (error) {
        loadError.value = error
      } finally {
        isLoading.value = false
      }
      // watcher 以 pre flush 非同步執行，等它跑過這一輪再解除保護，
      // 否則載入本身會觸發一次多餘的回寫。
      await nextTick()
      hydrating = false
    }

    watch(
      [todoList, projects, tags],
      () => {
        if (hydrating) return
        void flush()
      },
      { deep: true },
    )

    // -------------------------------------------------------------- 復原

    function record(command: UndoableCommand): void {
      undoStack.push(command)
      lastAction.value = command.label
      undoDepth.value = undoStack.size
    }

    async function undo(): Promise<string | null> {
      const label = await undoStack.undo()
      undoDepth.value = undoStack.size
      lastAction.value = label === null ? null : `已復原：${label}`
      return label
    }

    function dismissAction(): void {
      lastAction.value = null
    }

    // --------------------------------------------------------- 任務 CRUD

    const findIndex = (id: string): number => todoList.value.findIndex((t) => t.id === id)
    const bySortOrder = (a: StoredTask, b: StoredTask): number => a.order - b.order

    function addTask(taskName: string, overrides: Partial<StoredTask> = {}): StoredTask {
      const task = createTask(taskName, nextOrder(todoList.value), overrides)
      todoList.value.push(task)
      record({
        label: `新增「${taskName}」`,
        undo: () => {
          todoList.value = todoList.value.filter((t) => t.id !== task.id)
        },
        redo: () => {
          todoList.value.push(task)
        },
      })
      return task
    }

    function updateTask(id: string, patch: Partial<StoredTask>): void {
      const index = findIndex(id)
      if (index === -1) return
      const before = { ...(todoList.value[index] as StoredTask) }
      const after = { ...before, ...patch, updatedAt: Date.now() }
      todoList.value[index] = after
      record({
        label: `修改「${before.taskName}」`,
        undo: () => {
          const i = findIndex(id)
          if (i !== -1) todoList.value[i] = before
        },
        redo: () => {
          const i = findIndex(id)
          if (i !== -1) todoList.value[i] = after
        },
      })
    }

    /** 刪除任務，連同其子任務。 */
    function removeTask(id: string): void {
      const target = todoList.value.find((t) => t.id === id)
      if (!target) return
      const removed = todoList.value
        .filter((t) => t.id === id || t.parentId === id)
        .map((t) => ({ ...t }))
      todoList.value = todoList.value.filter((t) => t.id !== id && t.parentId !== id)
      record({
        label:
          removed.length > 1
            ? `刪除「${target.taskName}」與 ${removed.length - 1} 個子項`
            : `刪除「${target.taskName}」`,
        undo: () => {
          todoList.value = [...todoList.value, ...removed].sort(bySortOrder)
        },
        redo: () => {
          todoList.value = todoList.value.filter((t) => t.id !== id && t.parentId !== id)
        },
      })
    }

    function clearCompleted(): void {
      const removed = todoList.value.filter((t) => t.isCompleted).map((t) => ({ ...t }))
      if (removed.length === 0) return
      todoList.value = todoList.value.filter((t) => !t.isCompleted)
      record({
        label: `清除 ${removed.length} 項已完成`,
        undo: () => {
          todoList.value = [...todoList.value, ...removed].sort(bySortOrder)
        },
        redo: () => {
          todoList.value = todoList.value.filter((t) => !t.isCompleted)
        },
      })
    }

    /**
     * 切換完成狀態。
     *
     * 重複性任務在「完成」時不是消失，而是把到期日推進到下一次發生日並保持未完成——
     * 這就是「完成時才展開」，不預先產生無限筆資料。
     * 規則結束（超過 until 或 count 用盡）時才真正標記完成。
     */
    function toggleCompleted(id: string): void {
      const index = findIndex(id)
      if (index === -1) return
      const before = { ...(todoList.value[index] as StoredTask) }

      if (!before.isCompleted && before.recurrence && before.dueDate) {
        const next = nextOccurrence(before.recurrence, before.dueDate)
        if (next !== null) {
          const advanced = { ...before, dueDate: next, updatedAt: Date.now() }
          todoList.value[index] = advanced
          record({
            label: `完成「${before.taskName}」，下次 ${next}`,
            undo: () => {
              const i = findIndex(id)
              if (i !== -1) todoList.value[i] = before
            },
            redo: () => {
              const i = findIndex(id)
              if (i !== -1) todoList.value[i] = advanced
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
      todoList.value[index] = after
      record({
        label: `${after.isCompleted ? '完成' : '取消完成'}「${before.taskName}」`,
        undo: () => {
          const i = findIndex(id)
          if (i !== -1) todoList.value[i] = before
        },
        redo: () => {
          const i = findIndex(id)
          if (i !== -1) todoList.value[i] = after
        },
      })
    }

    function setAllCompleted(value: boolean): void {
      const before = todoList.value.map((t) => ({ ...t }))
      const now = Date.now()
      for (const task of todoList.value) {
        task.isCompleted = value
        task.completedAt = value ? now : null
        task.updatedAt = now
      }
      record({
        label: value ? '全部標記為完成' : '全部取消完成',
        undo: () => {
          todoList.value = before
        },
      })
    }

    /** 拖曳／鍵盤排序：把 id 移到 targetId 之前或之後。 */
    function moveTask(id: string, targetId: string, position: 'before' | 'after'): void {
      const moving = todoList.value.find((t) => t.id === id)
      const target = todoList.value.find((t) => t.id === targetId)
      if (!moving || !target || id === targetId) return

      const sorted = [...todoList.value].sort(bySortOrder)
      const targetIndex = sorted.findIndex((t) => t.id === targetId)
      const neighbour = sorted[position === 'before' ? targetIndex - 1 : targetIndex + 1] ?? null

      const previousOrder = moving.order
      // 取中間值而非重編號：一次拖曳只需寫入一列
      moving.order =
        position === 'before'
          ? orderBetween(neighbour?.order ?? null, target.order)
          : orderBetween(target.order, neighbour?.order ?? null)
      moving.updatedAt = Date.now()

      record({
        label: `移動「${moving.taskName}」`,
        undo: () => {
          const t = todoList.value.find((x) => x.id === id)
          if (t) t.order = previousOrder
        },
      })
    }

    // --------------------------------------------------------- 專案與標籤

    function addProject(name: string, color = '#1d4ed8'): StoredProject {
      const project: StoredProject = {
        id: crypto.randomUUID(),
        name,
        color,
        order: nextOrder(projects.value),
      }
      projects.value.push(project)
      record({
        label: `新增專案「${name}」`,
        undo: () => {
          projects.value = projects.value.filter((p) => p.id !== project.id)
        },
      })
      return project
    }

    /**
     * 刪除專案。
     *
     * 預設把底下的任務移到「未分類」而不是一併刪除——刪專案是組織動作，
     * 不該把使用者的工作內容一起帶走。要連任務一起刪必須明確指定。
     */
    function removeProject(id: string, options: { deleteTasks?: boolean } = {}): void {
      const project = projects.value.find((p) => p.id === id)
      if (!project) return
      const affected = todoList.value.filter((t) => t.projectId === id).map((t) => ({ ...t }))

      projects.value = projects.value.filter((p) => p.id !== id)
      if (options.deleteTasks) {
        todoList.value = todoList.value.filter((t) => t.projectId !== id)
      } else {
        for (const task of todoList.value) {
          if (task.projectId === id) task.projectId = null
        }
      }

      record({
        label: options.deleteTasks
          ? `刪除專案「${project.name}」與 ${affected.length} 項任務`
          : `刪除專案「${project.name}」，${affected.length} 項移至未分類`,
        undo: () => {
          projects.value = [...projects.value, project].sort((a, b) => a.order - b.order)
          if (options.deleteTasks) {
            todoList.value = [...todoList.value, ...affected].sort(bySortOrder)
          } else {
            const ids = new Set(affected.map((a) => a.id))
            for (const task of todoList.value) {
              if (ids.has(task.id)) task.projectId = id
            }
          }
        },
      })
    }

    function addTag(name: string, color = '#15803d'): StoredTag {
      const tag: StoredTag = { id: crypto.randomUUID(), name, color }
      tags.value.push(tag)
      record({
        label: `新增標籤「${name}」`,
        undo: () => {
          tags.value = tags.value.filter((t) => t.id !== tag.id)
        },
      })
      return tag
    }

    /** 刪除標籤時一併從所有任務身上移除，避免留下指向不存在標籤的 id。 */
    function removeTag(id: string): void {
      const tag = tags.value.find((t) => t.id === id)
      if (!tag) return
      const affected = new Set(
        todoList.value.filter((t) => t.tagIds.includes(id)).map((t) => t.id),
      )

      tags.value = tags.value.filter((t) => t.id !== id)
      for (const task of todoList.value) {
        if (task.tagIds.includes(id)) task.tagIds = task.tagIds.filter((t) => t !== id)
      }

      record({
        label: `刪除標籤「${tag.name}」`,
        undo: () => {
          tags.value = [...tags.value, tag]
          for (const task of todoList.value) {
            if (affected.has(task.id)) task.tagIds = [...task.tagIds, id]
          }
        },
      })
    }

    function setPriority(id: string, priority: Priority): void {
      updateTask(id, { priority })
    }

    function setRecurrence(id: string, recurrence: Recurrence | null): void {
      updateTask(id, { recurrence })
    }

    function toggleTag(taskId: string, tagId: string): void {
      const task = todoList.value.find((t) => t.id === taskId)
      if (!task) return
      const nextTags = task.tagIds.includes(tagId)
        ? task.tagIds.filter((t) => t !== tagId)
        : [...task.tagIds, tagId]
      updateTask(taskId, { tagIds: nextTags })
    }

    return {
      todoList,
      projects,
      tags,
      isSearch,
      keyword,
      isLoading,
      loadError,
      writeError,
      migration,
      lastAction,
      canUndo,
      undoDepth,
      init,
      flush,
      undo,
      dismissAction,
      addTask,
      updateTask,
      removeTask,
      clearCompleted,
      toggleCompleted,
      setAllCompleted,
      moveTask,
      addProject,
      removeProject,
      addTag,
      removeTag,
      setPriority,
      setRecurrence,
      toggleTag,
    }
  },
  {
    // 只有搜尋這類 UI 偏好留在 localStorage；任務本體已改由 IndexedDB 承載。
    persist: { key: 'todoTask:ui', sanitize: sanitizeUiPrefs },
  },
)
