import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { UndoStack, type UndoableCommand } from '@/domain/undo'

/**
 * 復原歷史。
 *
 * 獨立成一個 store 而非塞進任務 store，是因為它跟任務無關——
 * 專案、標籤、未來任何可復原的操作都會用到同一條歷史。
 * 綁在任務上會讓「復原剛剛刪掉的標籤」變成不可能。
 */
export const useHistoryStore = defineStore('history', () => {
  const stack = new UndoStack({ limit: 50 })

  /** UndoStack 是純物件、非響應式，用一個 ref 反映它的深度供畫面使用。 */
  const depth = ref(0)
  /** 最近一次操作的描述，供可復原提示顯示。 */
  const lastAction = ref<string | null>(null)

  const canUndo = computed(() => depth.value > 0)

  function record(command: UndoableCommand): void {
    stack.push(command)
    lastAction.value = command.label
    depth.value = stack.size
  }

  async function undo(): Promise<string | null> {
    const label = await stack.undo()
    depth.value = stack.size
    lastAction.value = label === null ? null : `已復原：${label}`
    return label
  }

  function dismiss(): void {
    lastAction.value = null
  }

  function clear(): void {
    stack.clear()
    depth.value = 0
    lastAction.value = null
  }

  return { depth, lastAction, canUndo, record, undo, dismiss, clear }
})
