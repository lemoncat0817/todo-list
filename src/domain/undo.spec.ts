import { describe, it, expect } from 'vitest'
import { UndoStack } from '@/domain/undo'

describe('UndoStack', () => {
  it('空堆疊不能復原也不能重做', () => {
    const stack = new UndoStack()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    expect(stack.nextUndoLabel).toBeNull()
  })

  it('復原會執行反向操作並回傳描述', async () => {
    const stack = new UndoStack()
    let value = 2
    stack.push({ label: '把 1 改成 2', undo: () => { value = 1 } })

    expect(await stack.undo()).toBe('把 1 改成 2')
    expect(value).toBe(1)
    expect(stack.canUndo).toBe(false)
  })

  it('後進先出', async () => {
    const stack = new UndoStack()
    const order: string[] = []
    stack.push({ label: 'A', undo: () => { order.push('A') } })
    stack.push({ label: 'B', undo: () => { order.push('B') } })

    await stack.undo()
    await stack.undo()
    expect(order).toEqual(['B', 'A'])
  })

  it('沒東西可復原時回傳 null 而不是拋錯', async () => {
    const stack = new UndoStack()
    await expect(stack.undo()).resolves.toBeNull()
  })

  it('等待非同步的反向操作完成', async () => {
    const stack = new UndoStack()
    let done = false
    stack.push({
      label: '非同步',
      undo: async () => {
        await Promise.resolve()
        done = true
      },
    })

    await stack.undo()
    expect(done).toBe(true)
  })

  describe('重做', () => {
    it('有提供 redo 時才可重做', async () => {
      const stack = new UndoStack()
      let value = 1
      stack.push({ label: '設為 1', undo: () => { value = 0 }, redo: () => { value = 1 } })

      await stack.undo()
      expect(value).toBe(0)
      expect(stack.canRedo).toBe(true)

      await stack.redo()
      expect(value).toBe(1)
      expect(stack.canUndo).toBe(true)
    })

    it('沒有 redo 的步驟不進入重做鏈', async () => {
      const stack = new UndoStack()
      stack.push({ label: '不可重做', undo: () => {} })
      await stack.undo()
      expect(stack.canRedo).toBe(false)
    })

    it('新的操作會讓重做鏈失效', async () => {
      const stack = new UndoStack()
      stack.push({ label: 'A', undo: () => {}, redo: () => {} })
      await stack.undo()
      expect(stack.canRedo).toBe(true)

      stack.push({ label: 'B', undo: () => {} })
      expect(stack.canRedo, '這是所有編輯器的通用語意').toBe(false)
    })
  })

  describe('有界', () => {
    it('超過上限時丟棄最舊的步驟', async () => {
      const stack = new UndoStack({ limit: 3 })
      const undone: string[] = []
      for (const label of ['A', 'B', 'C', 'D', 'E']) {
        stack.push({ label, undo: () => { undone.push(label) } })
      }

      expect(stack.size).toBe(3)
      while (stack.canUndo) await stack.undo()
      expect(undone, '只留最新的三步').toEqual(['E', 'D', 'C'])
    })

    it('limit 至少為 1', () => {
      const stack = new UndoStack({ limit: 0 })
      stack.push({ label: 'A', undo: () => {} })
      expect(stack.size).toBe(1)
    })
  })

  it('nextUndoLabel 反映堆疊頂端', () => {
    const stack = new UndoStack()
    stack.push({ label: 'A', undo: () => {} })
    stack.push({ label: 'B', undo: () => {} })
    expect(stack.nextUndoLabel).toBe('B')
  })

  it('clear 清空兩條鏈', async () => {
    const stack = new UndoStack()
    stack.push({ label: 'A', undo: () => {}, redo: () => {} })
    await stack.undo()
    stack.clear()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })
})
