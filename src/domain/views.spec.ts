import { describe, it, expect } from 'vitest'
import {
  emptyMessage,
  matchesView,
  overdueCount,
  resolveView,
  sortTasks,
  viewCount,
  viewTitle,
  type ViewSpec,
} from './views'
import { makeTask } from '@/test/helpers'

/**
 * 「今天」與「即將到來」都必須把逾期任務算進來——這是這一層最重要的產品決策，
 * 所以測試也繞著它打轉。日期一律用本地時間建構的 Date，避免 UTC 位移讓測試在
 * 不同時區出現不同結果。
 */
const NOW = new Date(2030, 0, 15, 10, 0, 0) // 2030-01-15
const spec = (kind: ViewSpec['kind'], id: string | null = null): ViewSpec => ({ kind, id })

describe('matchesView', () => {
  it('今天：包含今天到期與所有逾期，排除未來與已完成', () => {
    const cases = [
      [makeTask('昨天', false, { dueDate: '2030-01-14' }), true],
      [makeTask('今天', false, { dueDate: '2030-01-15' }), true],
      [makeTask('明天', false, { dueDate: '2030-01-16' }), false],
      [makeTask('沒日期', false), false],
      [makeTask('逾期但完成了', true, { dueDate: '2030-01-01' }), false],
    ] as const
    for (const [task, expected] of cases) {
      expect(matchesView(task, spec('today'), NOW), task.taskName).toBe(expected)
    }
  })

  it('即將到來：涵蓋未來七天（含今天），第八天起排除', () => {
    expect(matchesView(makeTask('第七天', false, { dueDate: '2030-01-21' }), spec('upcoming'), NOW)).toBe(true)
    expect(matchesView(makeTask('第八天', false, { dueDate: '2030-01-22' }), spec('upcoming'), NOW)).toBe(false)
    expect(matchesView(makeTask('逾期', false, { dueDate: '2029-12-01' }), spec('upcoming'), NOW)).toBe(true)
  })

  it('收件匣：未分類且未完成', () => {
    expect(matchesView(makeTask('未分類', false), spec('inbox'), NOW)).toBe(true)
    expect(matchesView(makeTask('有專案', false, { projectId: 'p1' }), spec('inbox'), NOW)).toBe(false)
    expect(matchesView(makeTask('已完成', true), spec('inbox'), NOW)).toBe(false)
  })

  it('收件匣：projectId 指向這個工作區真正的收件匣專案，等同沒有專案', () => {
    // 見 db/schema.ts 的 StoredProject.isInbox 說明——task 同步一輪回來，
    // projectId 會從 null 換成伺服器真正的收件匣 UUID，這裡不能因此漏收。
    const inboxIds = new Set(['real-inbox-uuid'])
    const task = makeTask('同步過的收件匣任務', false, { projectId: 'real-inbox-uuid' })
    expect(matchesView(task, spec('inbox'), NOW, inboxIds)).toBe(true)
    expect(matchesView(task, spec('inbox'), NOW)).toBe(false)
    expect(matchesView(task, spec('project', 'real-inbox-uuid'), NOW, inboxIds)).toBe(true)
  })

  it('專案與標籤依 id 比對', () => {
    const task = makeTask('分類過的', false, { projectId: 'p1', tagIds: ['t1'] })
    expect(matchesView(task, spec('project', 'p1'), NOW)).toBe(true)
    expect(matchesView(task, spec('project', 'p2'), NOW)).toBe(false)
    expect(matchesView(task, spec('label', 't1'), NOW)).toBe(true)
    expect(matchesView(task, spec('label', 't2'), NOW)).toBe(false)
  })

  it('專案與標籤檢視排除已完成，已完成的事只在歷史檢視出現', () => {
    const done = makeTask('做完了', true, { projectId: 'p1', tagIds: ['t1'] })
    expect(matchesView(done, spec('project', 'p1'), NOW)).toBe(false)
    expect(matchesView(done, spec('label', 't1'), NOW)).toBe(false)
    expect(matchesView(done, spec('completed'), NOW)).toBe(true)
  })

  it('label 檢視的 id 為 null 時不比對任何任務', () => {
    expect(matchesView(makeTask('有標籤', false, { tagIds: ['t1'] }), spec('label'), NOW)).toBe(false)
  })
})

describe('resolveView', () => {
  const tasks = [
    makeTask('逾期兩天', false, { dueDate: '2030-01-13', order: 3 }),
    makeTask('逾期一天', false, { dueDate: '2030-01-14', order: 2 }),
    makeTask('今天到期', false, { dueDate: '2030-01-15', order: 1 }),
    makeTask('明天到期', false, { dueDate: '2030-01-16' }),
    makeTask('沒有日期', false),
  ]

  it('今天：分成逾期與今天兩組，逾期在前', () => {
    const groups = resolveView(tasks, spec('today'), { now: NOW })
    expect(groups.map((g) => g.key)).toEqual(['overdue', '2030-01-15'])
    expect(groups[0]?.label).toBe('逾期 2')
    expect(groups[0]?.tasks.map((t) => t.taskName)).toEqual(['逾期兩天', '逾期一天'])
    expect(groups[1]?.tasks.map((t) => t.taskName)).toEqual(['今天到期'])
  })

  it('空的分組不會出現，避免看到有標題卻沒有內容的區塊', () => {
    const groups = resolveView([makeTask('明天', false, { dueDate: '2030-01-16' })], spec('today'), {
      now: NOW,
    })
    expect(groups).toEqual([])
  })

  it('即將到來：逾期在前，其後依日期分組', () => {
    const groups = resolveView(tasks, spec('upcoming'), { now: NOW })
    expect(groups.map((g) => g.key)).toEqual(['overdue', '2030-01-15', '2030-01-16'])
    expect(groups[1]?.label).toBe('今天 · 2030-01-15')
    expect(groups[2]?.label).toBe('明天 · 2030-01-16')
  })

  it('不分組的檢視回傳單一組，且 label 為空字串', () => {
    const groups = resolveView(tasks, spec('all'), { now: NOW })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe('')
    expect(groups[0]?.tasks).toHaveLength(5)
  })

  it('已完成依完成時間新到舊排列', () => {
    // makeTask 會用「現在」蓋掉 completedAt，這裡建立後再指定，才測得到排序本身
    const done = [
      { ...makeTask('先完成的', true), completedAt: 1000 },
      { ...makeTask('後完成的', true), completedAt: 2000 },
    ]
    const groups = resolveView(done, spec('completed'), { now: NOW })
    expect(groups[0]?.tasks.map((t) => t.taskName)).toEqual(['後完成的', '先完成的'])
  })

  it('子任務不佔清單一列', () => {
    const withChild = [...tasks, makeTask('子項', false, { parentId: 'x', dueDate: '2030-01-15' })]
    const groups = resolveView(withChild, spec('today'), { now: NOW })
    const all = groups.flatMap((g) => g.tasks.map((t) => t.taskName))
    expect(all).not.toContain('子項')
  })

  it('關鍵字與檢視同時套用', () => {
    const groups = resolveView(tasks, spec('all'), { now: NOW, keyword: '逾期' })
    // 'all' 檢視維持手動順序，逾期一天的 order 較小所以排在前
    expect(groups[0]?.tasks.map((t) => t.taskName)).toEqual(['逾期一天', '逾期兩天'])
  })
})

describe('viewCount', () => {
  it('與 resolveView 得到同一個數字', () => {
    const tasks = [
      makeTask('逾期', false, { dueDate: '2030-01-01' }),
      makeTask('今天', false, { dueDate: '2030-01-15' }),
      makeTask('未來', false, { dueDate: '2030-06-01' }),
    ]
    const groups = resolveView(tasks, spec('today'), { now: NOW })
    const listed = groups.reduce((n, g) => n + g.tasks.length, 0)
    expect(viewCount(tasks, spec('today'), { now: NOW })).toBe(listed)
    expect(listed).toBe(2)
  })
})

describe('overdueCount', () => {
  it('只算未完成的頂層逾期任務', () => {
    const tasks = [
      makeTask('逾期', false, { dueDate: '2030-01-01' }),
      makeTask('逾期但完成', true, { dueDate: '2030-01-01' }),
      makeTask('逾期子項', false, { dueDate: '2030-01-01', parentId: 'x' }),
      makeTask('今天', false, { dueDate: '2030-01-15' }),
    ]
    expect(overdueCount(tasks, NOW)).toBe(1)
  })
})

describe('viewTitle', () => {
  it('固定檢視有固定標題', () => {
    expect(viewTitle(spec('today'))).toBe('今天')
    expect(viewTitle(spec('all'))).toBe('全部')
  })

  it('專案與標籤取名稱，找不到時給出可理解的替代文字', () => {
    const collections = { projects: [{ id: 'p1', name: '工作' }], tags: [{ id: 't1', name: '緊急' }] }
    expect(viewTitle(spec('project', 'p1'), collections)).toBe('工作')
    expect(viewTitle(spec('label', 't1'), collections)).toBe('#緊急')
    expect(viewTitle(spec('project', 'nope'), collections)).toBe('找不到這個專案')
  })
})

describe('emptyMessage', () => {
  it('有關鍵字時一律說明是搜尋沒找到', () => {
    expect(emptyMessage(spec('today'), '牛奶')).toBe('找不到符合「牛奶」的代辦事項')
  })

  it('各檢視有各自的空狀態說明', () => {
    expect(emptyMessage(spec('today'))).toBe('今天沒有到期的事，很好')
    expect(emptyMessage(spec('inbox'))).toContain('收件匣')
  })
})

describe('sortTasks', () => {
  const tasks = [
    makeTask('沒日期低優先', false, { order: 1, priority: 0, dueDate: null }),
    makeTask('明天中優先', false, { order: 2, priority: 2, dueDate: '2030-01-16' }),
    makeTask('今天最高', false, { order: 3, priority: 3, dueDate: '2030-01-15' }),
  ]

  it('預設維持手動順序——那是使用者自己排的判斷', () => {
    expect(sortTasks(tasks).map((t) => t.taskName)).toEqual(['沒日期低優先', '明天中優先', '今天最高'])
  })

  it('依到期日排序時，沒有日期的排最後（那是「沒排」不是「很早」）', () => {
    expect(sortTasks(tasks, 'due').map((t) => t.taskName)).toEqual([
      '今天最高',
      '明天中優先',
      '沒日期低優先',
    ])
  })

  it('依優先度排序由高到低', () => {
    expect(sortTasks(tasks, 'priority').map((t) => t.priority)).toEqual([3, 2, 0])
  })

  it('同分時以 order 收尾，避免每次渲染順序都在跳', () => {
    const tie = [
      makeTask('後加的', false, { order: 20, priority: 1 }),
      makeTask('先加的', false, { order: 10, priority: 1 }),
    ]
    expect(sortTasks(tie, 'priority').map((t) => t.taskName)).toEqual(['先加的', '後加的'])
  })
})

describe('resolveView — 分組與排序設定', () => {
  const tasks = [
    makeTask('工作的事', false, { projectId: 'p1', order: 2, priority: 3 }),
    makeTask('未分類的事', false, { order: 1, priority: 1 }),
  ]

  it('依專案分組時，未分類固定排最後', () => {
    const groups = resolveView(tasks, spec('all'), {
      now: NOW,
      groupBy: 'project',
      projects: [{ id: 'p1', name: '工作' }],
    })
    expect(groups.map((g) => g.label)).toEqual(['工作', '未分類'])
  })

  it('依專案分組時，收件匣專案的任務併進「未分類」，不會自成一組', () => {
    const withInboxTask = [...tasks, makeTask('同步過的收件匣任務', false, { projectId: 'inbox-uuid', order: 3 })]
    const groups = resolveView(withInboxTask, spec('all'), {
      now: NOW,
      groupBy: 'project',
      projects: [{ id: 'p1', name: '工作' }],
      inboxProjectIds: new Set(['inbox-uuid']),
    })
    expect(groups.map((g) => g.label)).toEqual(['工作', '未分類'])
    expect(groups.find((g) => g.label === '未分類')?.tasks.map((t) => t.taskName).sort()).toEqual([
      '同步過的收件匣任務',
      '未分類的事',
    ])
  })

  it('依優先度分組時標題用對外的 P 編號', () => {
    const groups = resolveView(tasks, spec('all'), { now: NOW, groupBy: 'priority' })
    expect(groups.map((g) => g.label)).toEqual(['P1', 'P3'])
  })

  it('依負責人分組時，未指派固定排最後，標題用成員顯示名稱', () => {
    const withAssignee = [
      makeTask('指派給 Bob 的事', false, { order: 3, assigneeId: 'bob' }),
      ...tasks,
    ]
    const groups = resolveView(withAssignee, spec('all'), {
      now: NOW,
      groupBy: 'assignee',
      assignees: [{ id: 'bob', name: 'Bob' }],
    })
    expect(groups.map((g) => g.label)).toEqual(['Bob', '未指派'])
    expect(groups.find((g) => g.label === '未指派')?.tasks.map((t) => t.taskName).sort()).toEqual([
      '工作的事',
      '未分類的事',
    ])
  })

  it('依負責人分組時，找不到對應成員（已離開工作區）顯示「已離開的成員」，跟「本來就沒指派」分開', () => {
    const withAssignee = [makeTask('指派給已離開成員的事', false, { assigneeId: 'ghost' })]
    const groups = resolveView(withAssignee, spec('all'), { now: NOW, groupBy: 'assignee' })
    expect(groups.map((g) => g.label)).toEqual(['已離開的成員'])
  })

  it('排序設定套用在每個分組之內', () => {
    const groups = resolveView(tasks, spec('all'), { now: NOW, sort: 'priority' })
    expect(groups[0]?.tasks.map((t) => t.taskName)).toEqual(['工作的事', '未分類的事'])
  })
})

describe('resolveView — filter 檢視', () => {
  const tasks = [
    makeTask('要留下的', false, { priority: 3 }),
    makeTask('要濾掉的', false, { priority: 0 }),
  ]

  it('條件完全由外部述詞決定', () => {
    const groups = resolveView(tasks, spec('filter', 'p1'), {
      now: NOW,
      predicate: (t) => t.priority === 3,
    })
    expect(groups[0]?.tasks.map((t) => t.taskName)).toEqual(['要留下的'])
  })

  it('查詢寫錯（predicate 為 null）時一筆都不回傳，而不是假裝沒有結果', () => {
    expect(resolveView(tasks, spec('filter', '壞查詢'), { now: NOW, predicate: null })).toEqual([])
  })
})
