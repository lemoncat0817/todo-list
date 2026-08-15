/**
 * 復原堆疊。
 *
 * 以指令模式保存「反向操作」，取代原本每個破壞性動作都跳 confirm 的作法
 * （稽核 P15 / P16）。可復原比先問一次更好：不打斷流程，而且真的救得回來。
 *
 * 刻意有界（預設 50 步）：無界的堆疊會一直握著已刪除任務的參照，
 * 在長時間使用的分頁裡就是記憶體洩漏。
 */

export interface UndoableCommand {
  /** 顯示在提示訊息上的描述，例如「刪除了 3 項」。 */
  label: string
  /** 反向操作。回傳 Promise 時呼叫端會等待完成。 */
  undo: () => void | Promise<void>
  /** 重做。沒有提供時該步驟不可重做。 */
  redo?: () => void | Promise<void>
}

export interface UndoStackOptions {
  limit?: number
}

export class UndoStack {
  private undoable: UndoableCommand[] = []
  private redoable: UndoableCommand[] = []
  private readonly limit: number

  constructor({ limit = 50 }: UndoStackOptions = {}) {
    this.limit = Math.max(1, limit)
  }

  get canUndo(): boolean {
    return this.undoable.length > 0
  }

  get canRedo(): boolean {
    return this.redoable.length > 0
  }

  /** 下一個可復原步驟的描述，供提示訊息使用。 */
  get nextUndoLabel(): string | null {
    return this.undoable[this.undoable.length - 1]?.label ?? null
  }

  get size(): number {
    return this.undoable.length
  }

  push(command: UndoableCommand): void {
    this.undoable.push(command)
    // 新的動作會讓既有的重做鏈失效，這是所有編輯器的通用語意
    this.redoable = []
    if (this.undoable.length > this.limit) {
      this.undoable.splice(0, this.undoable.length - this.limit)
    }
  }

  async undo(): Promise<string | null> {
    const command = this.undoable.pop()
    if (!command) return null
    await command.undo()
    if (command.redo) this.redoable.push(command)
    return command.label
  }

  async redo(): Promise<string | null> {
    const command = this.redoable.pop()
    if (!command) return null
    await command.redo?.()
    this.undoable.push(command)
    return command.label
  }

  clear(): void {
    this.undoable = []
    this.redoable = []
  }
}
