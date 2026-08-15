import { defineStore } from 'pinia'
import { nextTick, ref, toRaw, watch } from 'vue'
import { loadTasks, migrateFromLocalStorage, nextOrder, saveTasks } from '@/db'
import type { StoredTask } from '@/db/schema'
import { sanitizeUiPrefs } from './sanitize'

export const useTodoTaskStore = defineStore(
  'todoTask',
  () => {
    const todoList = ref<StoredTask[]>([])
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
    /** 遷移結果，供啟動時告知使用者有幾筆資料被跳過。 */
    const migration = ref<{ migrated: number; skipped: number } | null>(null)

    /**
     * 寫入策略：立即寫，不做延遲防抖。
     *
     * 防抖會讓「操作後立刻重新整理」有丟資料的空窗，對一個以資料保存為
     * 本分的工具來說不能接受。這裡改成寫入進行中時只標記 dirty，
     * 完成後再補寫一次，效果是自動合併連續變更且沒有空窗。
     */
    let inFlight: Promise<void> | null = null
    let dirty = false
    /** 載入期間為 true；watcher 是非同步的，不能只靠 isLoading 判斷。 */
    let hydrating = false

    function snapshot(): StoredTask[] {
      return toRaw(todoList.value).map((t) => ({ ...toRaw(t) }))
    }

    /**
     * 回傳的 Promise 一定在「資料真的寫完」時才 resolve，
     * 即使呼叫時已有寫入在進行中也一樣——否則呼叫端無法確知何時安全。
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

    // 載入完成後才開始回寫，否則初始的空陣列會把既有資料清掉。
    watch(
      todoList,
      () => {
        if (hydrating) return
        void flush()
      },
      { deep: true },
    )

    function addTask(taskName: string): StoredTask {
      const task: StoredTask = {
        // 稽核 P17：改用 randomUUID，不再用 Date.now() 當 id（同毫秒會碰撞）
        id: crypto.randomUUID(),
        taskName,
        isCompleted: false,
        order: nextOrder(todoList.value),
      }
      todoList.value.push(task)
      return task
    }

    function removeTask(id: string): void {
      todoList.value = todoList.value.filter((t) => t.id !== id)
    }

    function clearCompleted(): void {
      todoList.value = todoList.value.filter((t) => !t.isCompleted)
    }

    function setAllCompleted(value: boolean): void {
      for (const task of todoList.value) task.isCompleted = value
    }

    return {
      todoList,
      isSearch,
      keyword,
      isLoading,
      loadError,
      writeError,
      migration,
      init,
      flush,
      addTask,
      removeTask,
      clearCompleted,
      setAllCompleted,
    }
  },
  {
    // 只有搜尋這類 UI 偏好留在 localStorage；任務本體已改由 IndexedDB 承載。
    persist: { key: 'todoTask:ui', sanitize: sanitizeUiPrefs },
  },
)
