import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * 清單範圍的鍵盤操作。
 *
 * 與 useShortcuts 分開：那裡放的是「不管在看哪個畫面都成立」的鍵（n、/、Ctrl+Z），
 * 這裡放的是「作用在某一列上」的鍵。混在一起的話，全域那層就得知道
 * 清單長什麼樣子、現在有幾列、哪一列被聚焦——那是清單自己的事。
 *
 * 焦點用真正的 DOM 焦點，而不是自己維護一個「目前選取的索引」：
 * 自訂的焦點概念螢幕閱讀器讀不到，而且會跟 Tab 鍵走出兩條不同的路徑。
 */
export interface ListKeyboardActions {
  /** x：把目前這一列加入／移出批次選取 */
  toggleChecked: (id: string) => void
  /** e：編輯 */
  edit: (id: string) => void
  /** t：開啟排程選單 */
  schedule: (id: string) => void
  /** Enter：開啟詳情 */
  openDetail: (id: string) => void
  /** Space：完成／取消完成 */
  toggleComplete: (id: string) => void
}

const ROW_SELECTOR = '[data-task-id]'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useListKeyboard(
  container: Ref<HTMLElement | null>,
  actions: ListKeyboardActions,
): void {
  function rows(): HTMLElement[] {
    return [...(container.value?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
  }

  function focusedRow(): HTMLElement | null {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null
    return active.closest<HTMLElement>(ROW_SELECTOR)
  }

  function move(delta: 1 | -1): void {
    const all = rows()
    if (all.length === 0) return
    const current = focusedRow()
    const index = current === null ? -1 : all.indexOf(current)
    // 還沒有焦點時，j 從第一列開始、k 從最後一列開始——
    // 兩個方向都應該能「進入」清單，而不是只有其中一個有反應
    const next = index === -1 ? (delta === 1 ? 0 : all.length - 1) : index + delta
    all[Math.max(0, Math.min(all.length - 1, next))]?.focus()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return

    const key = event.key.toLowerCase()
    if (key === 'j' || key === 'arrowdown') {
      event.preventDefault()
      move(1)
      return
    }
    if (key === 'k' || key === 'arrowup') {
      event.preventDefault()
      move(-1)
      return
    }

    const row = focusedRow()
    const id = row?.dataset.taskId
    if (id === undefined) return

    const handlers: Record<string, () => void> = {
      x: () => actions.toggleChecked(id),
      e: () => actions.edit(id),
      t: () => actions.schedule(id),
      enter: () => actions.openDetail(id),
      ' ': () => actions.toggleComplete(id),
    }
    const handler = handlers[key]

    if (handler) {
      event.preventDefault()
      handler()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
