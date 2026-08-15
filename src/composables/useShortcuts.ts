import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 全域鍵盤快捷鍵。
 *
 * 兩個必要的防呆：
 * 1. 使用者正在輸入框裡打字時不攔截（除了 Escape），否則會搶走正常輸入。
 * 2. 以 event.key 判斷而非 keyCode，才能在非 QWERTY 佈局上正確運作。
 */

export interface ShortcutHandlers {
  /** Ctrl/Cmd + Z */
  undo?: () => void
  /** 「/」聚焦搜尋 */
  focusSearch?: () => void
  /** 「n」新增 */
  focusNew?: () => void
  /** Escape */
  escape?: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  function onKeydown(event: KeyboardEvent): void {
    const typing = isTypingTarget(event.target)

    // Escape 在輸入中也要能用（取消編輯／關閉提示）
    if (event.key === 'Escape') {
      handlers.escape?.()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      handlers.undo?.()
      return
    }

    if (typing) return

    if (event.key === '/') {
      event.preventDefault()
      handlers.focusSearch?.()
      return
    }

    if (event.key.toLowerCase() === 'n') {
      event.preventDefault()
      handlers.focusNew?.()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
