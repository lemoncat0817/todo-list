import { describe, it, expect } from 'vitest'
import { sanitizeTask, sanitizeState, safeSerializer } from '@/stores/sanitize'

/**
 * 稽核 P2：持久化狀態的邊界驗證。
 * 這裡涵蓋的每一種壞資料形狀，都對應 Phase 0 在真實瀏覽器實測過的案例。
 */
describe('sanitizeTask', () => {
  it('保留合法項目，並把 isCompleted 正規化為布林', () => {
    expect(sanitizeTask({ id: 1, taskName: '買牛奶', isCompleted: true })).toEqual({
      id: 1,
      taskName: '買牛奶',
      isCompleted: true,
    })
  })

  it('isCompleted 缺失或非 true 時一律視為未完成', () => {
    expect(sanitizeTask({ id: 1, taskName: 'a' })?.isCompleted).toBe(false)
    expect(sanitizeTask({ id: 1, taskName: 'a', isCompleted: 'yes' })?.isCompleted).toBe(false)
    expect(sanitizeTask({ id: 1, taskName: 'a', isCompleted: 1 })?.isCompleted).toBe(false)
  })

  it('不再輸出 isEdit —— 編輯狀態不屬於領域資料（稽核 P1）', () => {
    const out = sanitizeTask({ id: 1, taskName: 'a', isCompleted: false, isEdit: true })
    expect(out).not.toHaveProperty('isEdit')
  })

  it('id 接受數字與非空字串', () => {
    expect(sanitizeTask({ id: 7, taskName: 'a' })).not.toBeNull()
    expect(sanitizeTask({ id: 'uuid-x', taskName: 'a' })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['陣列', []],
    ['字串', 'nope'],
    ['數字', 42],
    ['缺 id', { taskName: 'a' }],
    ['id 為 null', { id: null, taskName: 'a' }],
    ['id 為空字串', { id: '', taskName: 'a' }],
    ['id 為 NaN', { id: NaN, taskName: 'a' }],
    ['缺 taskName', { id: 1, isCompleted: false }],
    ['taskName 為數字', { id: 1, taskName: 123 }],
    ['taskName 為空字串', { id: 1, taskName: '' }],
    ['taskName 為 null', { id: 1, taskName: null }],
  ])('丟棄無效項目：%s', (_label, input) => {
    expect(sanitizeTask(input)).toBeNull()
  })
})

describe('sanitizeState', () => {
  it('保留合法狀態的每一個欄位', () => {
    expect(
      sanitizeState({
        todoList: [{ id: 1, taskName: 'a', isCompleted: true }],
        pages: 2,
        isSearch: true,
        keyword: '牛奶',
      }),
    ).toEqual({
      todoList: [{ id: 1, taskName: 'a', isCompleted: true }],
      pages: 2,
      isSearch: true,
      keyword: '牛奶',
    })
  })

  it('濾掉陣列中的無效項目，保留有效的', () => {
    const out = sanitizeState({
      todoList: [
        { id: 1, taskName: '有效', isCompleted: false },
        null,
        { id: 2, taskName: 123 },
        { id: 3, taskName: '也有效', isCompleted: true },
      ],
    })
    expect(out.todoList).toEqual([
      { id: 1, taskName: '有效', isCompleted: false },
      { id: 3, taskName: '也有效', isCompleted: true },
    ])
  })

  // 對應 Phase 0 在瀏覽器實測會造成 header/footer 消失的五種形狀
  it.each([
    ['todoList 為 null', { todoList: null }],
    ['todoList 為字串', { todoList: 'oops' }],
    ['todoList 為數字', { todoList: 42 }],
    ['todoList 為物件', { todoList: { a: 1 } }],
    ['todoList 為布林', { todoList: true }],
  ])('%s → 不覆寫 todoList，讓 store 保留預設空陣列', (_label, input) => {
    expect(sanitizeState(input)).not.toHaveProperty('todoList')
  })

  it.each([
    ['null', null],
    ['陣列', [1, 2]],
    ['字串', 'just a string'],
    ['數字', 42],
    ['布林', false],
  ])('整份狀態不是物件時回傳空物件：%s', (_label, input) => {
    expect(sanitizeState(input)).toEqual({})
  })

  it.each([-1, 3, 99, 1.5, null, 'ㄧ', NaN, undefined])(
    'pages=%s 為非法值時不覆寫，保留預設 0（稽核 P3 的第二道防線）',
    (bad) => {
      expect(sanitizeState({ pages: bad })).not.toHaveProperty('pages')
    },
  )

  it.each([0, 1, 2])('pages=%s 為合法值時保留', (ok) => {
    expect(sanitizeState({ pages: ok }).pages).toBe(ok)
  })

  it('isSearch 與 keyword 型別不符時不覆寫', () => {
    const out = sanitizeState({ isSearch: 'true', keyword: 123 })
    expect(out).not.toHaveProperty('isSearch')
    expect(out).not.toHaveProperty('keyword')
  })

  it('不讓未知欄位滲進 store', () => {
    const out = sanitizeState({ keyword: 'ok', __proto__: { polluted: true }, evil: 1 })
    expect(Object.keys(out)).toEqual(['keyword'])
  })
})

describe('safeSerializer', () => {
  it('round-trip 保持合法資料不變', () => {
    const state = {
      todoList: [{ id: 1, taskName: 'a', isCompleted: false }],
      pages: 1,
      isSearch: false,
      keyword: '',
    }
    expect(safeSerializer.deserialize(safeSerializer.serialize(state))).toEqual(state)
  })

  it('JSON 語法錯誤時拋錯，交由 plugin 的 try/catch 接住並退回預設值', () => {
    expect(() => safeSerializer.deserialize('{todoList: [}')).toThrow()
  })

  it('壞形狀不會拋錯，直接被過濾掉', () => {
    expect(safeSerializer.deserialize('{"todoList":null}')).toEqual({})
    expect(safeSerializer.deserialize('{"todoList":42}')).toEqual({})
  })
})
