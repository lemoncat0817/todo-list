import { describe, it, expect } from 'vitest'
import {
  createTask,
  groupByParent,
  isEffectivelyComplete,
  monotonicNow,
  normalizeOp,
  normalizeProject,
  normalizeTag,
  normalizeTask,
} from '@/domain/task'
import { makeTask } from '@/test/helpers'

describe('normalizeTask', () => {
  it('補齊缺少的欄位為安全預設值', () => {
    const task = normalizeTask({ id: 'a', taskName: '只有必要欄位' })
    expect(task).toMatchObject({
      id: 'a',
      taskName: '只有必要欄位',
      isCompleted: false,
      notes: '',
      priority: 0,
      dueDate: null,
      dueTime: null,
      projectId: null,
      tagIds: [],
      parentId: null,
      recurrence: null,
      completedAt: null,
    })
  })

  it.each([
    ['null', null],
    ['陣列', []],
    ['字串', 'task'],
    ['缺 id', { taskName: 'x' }],
    ['id 為空字串', { id: '', taskName: 'x' }],
    ['缺 taskName', { id: 'a' }],
    ['taskName 為空字串', { id: 'a', taskName: '' }],
    ['taskName 為數字', { id: 'a', taskName: 42 }],
  ])('無法構成有效任務時回傳 null：%s', (_label, input) => {
    expect(normalizeTask(input)).toBeNull()
  })

  it('數字 id 轉成字串', () => {
    expect(normalizeTask({ id: 1700000000000, taskName: 'x' })?.id).toBe('1700000000000')
  })

  it.each([-1, 4, 1.5, '3', null, undefined, NaN])(
    '優先度為非法值 %s 時退回 0',
    (bad) => {
      expect(normalizeTask({ id: 'a', taskName: 'x', priority: bad })?.priority).toBe(0)
    },
  )

  it.each([0, 1, 2, 3])('優先度 %s 為合法值時保留', (ok) => {
    expect(normalizeTask({ id: 'a', taskName: 'x', priority: ok })?.priority).toBe(ok)
  })

  it('沒有到期日時丟棄時間 —— 沒有日期的時間沒有意義', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', dueTime: '09:30' })
    expect(task?.dueDate).toBeNull()
    expect(task?.dueTime).toBeNull()
  })

  it('有到期日時保留合法時間', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', dueDate: '2030-01-01', dueTime: '09:30' })
    expect(task?.dueTime).toBe('09:30')
  })

  it('時間格式非法時丟棄，但保留日期', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', dueDate: '2030-01-01', dueTime: '25:99' })
    expect(task?.dueDate).toBe('2030-01-01')
    expect(task?.dueTime).toBeNull()
  })

  it.each(['2030-1-1', '2030/01/01', '2030-02-30', 42, null])(
    '到期日格式非法時退回 null：%s',
    (bad) => {
      expect(normalizeTask({ id: 'a', taskName: 'x', dueDate: bad })?.dueDate).toBeNull()
    },
  )

  it('tagIds 去除重複與非字串', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', tagIds: ['t1', 't1', 42, '', 't2'] })
    expect(task?.tagIds).toEqual(['t1', 't2'])
  })

  it('tagIds 不是陣列時退回空陣列', () => {
    expect(normalizeTask({ id: 'a', taskName: 'x', tagIds: 'nope' })?.tagIds).toEqual([])
  })

  it('重複規則形狀不合時丟棄', () => {
    expect(normalizeTask({ id: 'a', taskName: 'x', recurrence: { freq: 'yearly' } })?.recurrence)
      .toBeNull()
  })

  it('已完成但沒有 completedAt 時補上時間戳', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', isCompleted: true })
    expect(typeof task?.completedAt).toBe('number')
  })

  it('未完成時 completedAt 一律為 null', () => {
    const task = normalizeTask({ id: 'a', taskName: 'x', isCompleted: false, completedAt: 123 })
    expect(task?.completedAt).toBeNull()
  })
})

describe('createTask', () => {
  it('產生 UUID 形狀的 id（稽核 P17）', () => {
    expect(createTask('x', 'A').id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('連續建立的 id 互不相同', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createTask('x', 'A').id))
    expect(ids.size).toBe(50)
  })

  it('overrides 可覆寫預設欄位', () => {
    expect(createTask('x', 'A', { priority: 3, notes: '備註' })).toMatchObject({
      priority: 3,
      notes: '備註',
    })
  })
})

describe('normalizeProject / normalizeTag', () => {
  it('合法輸入通過', () => {
    expect(normalizeProject({ id: 'p', name: '工作' })).toMatchObject({ id: 'p', name: '工作' })
    expect(normalizeTag({ id: 't', name: '緊急' })).toMatchObject({ id: 't', name: '緊急' })
  })

  it.each([null, {}, { id: 'p' }, { name: 'x' }, { id: '', name: 'x' }, { id: 'p', name: '' }])(
    '無效輸入回傳 null：%s',
    (bad) => {
      expect(normalizeProject(bad)).toBeNull()
      expect(normalizeTag(bad)).toBeNull()
    },
  )

  it('缺色彩時給預設值', () => {
    expect(normalizeProject({ id: 'p', name: 'x' })?.color).toBeTruthy()
    expect(normalizeTag({ id: 't', name: 'x' })?.color).toBeTruthy()
  })

  it('isInbox 缺值時預設 false，只有明確為 true 才視為收件匣', () => {
    expect(normalizeProject({ id: 'p', name: 'x' })?.isInbox).toBe(false)
    expect(normalizeProject({ id: 'p', name: 'x', isInbox: 'true' })?.isInbox).toBe(false)
    expect(normalizeProject({ id: 'p', name: 'x', isInbox: true })?.isInbox).toBe(true)
  })
})

describe('groupByParent', () => {
  it('把子任務依父項分組並依 order 排序', () => {
    const tasks = [
      makeTask('父', false, { id: 'p' }),
      makeTask('子二', false, { id: 'c2', parentId: 'p', order: 2 }),
      makeTask('子一', false, { id: 'c1', parentId: 'p', order: 1 }),
    ]
    const grouped = groupByParent(tasks)
    expect(grouped.get('p')?.map((t) => t.taskName)).toEqual(['子一', '子二'])
  })

  it('沒有子任務時是空 Map', () => {
    expect(groupByParent([makeTask('獨立')]).size).toBe(0)
  })
})

describe('isEffectivelyComplete', () => {
  it('沒有子項時沿用自身狀態', () => {
    expect(isEffectivelyComplete(makeTask('x', true), [])).toBe(true)
    expect(isEffectivelyComplete(makeTask('x', false), [])).toBe(false)
  })

  it('有子項時必須全部完成', () => {
    const parent = makeTask('父', false)
    expect(isEffectivelyComplete(parent, [makeTask('a', true), makeTask('b', true)])).toBe(true)
    expect(isEffectivelyComplete(parent, [makeTask('a', true), makeTask('b', false)])).toBe(false)
  })
})

describe('monotonicNow', () => {
  it('連續呼叫嚴格遞增，即使系統時間解析度不夠細（同一毫秒內連續呼叫）', () => {
    const values = Array.from({ length: 500 }, () => monotonicNow())
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number)
    }
  })

  it('回傳值不會比真實時間倒退太多——只在系統時間沒推進時才靠計數器墊上去', () => {
    const before = Date.now()
    const value = monotonicNow()
    expect(value).toBeGreaterThanOrEqual(before)
  })
})

describe('normalizeOp', () => {
  it('合法的 op 原樣通過', () => {
    const op = {
      id: 'op-1',
      kind: 'task.patch' as const,
      targetId: 'task-1',
      payload: { notes: 'x' },
      createdAt: 100,
      attempts: 0,
    }
    expect(normalizeOp(op)).toEqual(op)
  })

  it('缺 id／targetId，或 kind 不合法時回傳 null', () => {
    expect(normalizeOp({ kind: 'task.patch', targetId: 't', payload: {}, createdAt: 1, attempts: 0 })).toBeNull()
    expect(normalizeOp({ id: 'o', kind: 'task.patch', payload: {}, createdAt: 1, attempts: 0 })).toBeNull()
    expect(normalizeOp({ id: 'o', kind: 'not-a-real-kind', targetId: 't', payload: {}, createdAt: 1, attempts: 0 })).toBeNull()
  })

  it('payload 不是物件、createdAt／attempts 缺漏時補上安全預設值', () => {
    const result = normalizeOp({ id: 'o', kind: 'task.delete', targetId: 't', payload: 'not-an-object' })
    expect(result?.payload).toEqual({})
    expect(result?.attempts).toBe(0)
    expect(typeof result?.createdAt).toBe('number')
  })
})
