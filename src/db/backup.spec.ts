import { describe, it, expect } from 'vitest'
import {
  BACKUP_FORMAT,
  backupFilename,
  createBackup,
  mergeById,
  parseBackup,
  serializeBackup,
} from './backup'
import { DB_VERSION } from './schema'
import { makeTask } from '@/test/helpers'

const payload = {
  tasks: [makeTask('買牛奶', false, { id: 't1' })],
  projects: [{ id: 'p1', name: '工作', color: '#1d4ed8', rank: 'A', updatedAt: 1000, isInbox: false }],
  tags: [{ id: 'g1', name: '緊急', color: '#15803d', updatedAt: 1000 }],
  filters: [{ id: 'f1', name: '要事', query: 'today & p1', color: '#7c3aed', rank: 'A', updatedAt: 1000 }],
}

describe('createBackup', () => {
  it('帶上格式標記與 schema 版號，讓日後的舊檔升級有依據', () => {
    const backup = createBackup(payload, new Date(2030, 0, 15))
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(DB_VERSION)
    expect(backup.exportedAt).toContain('2030-01-1')
  })

  it('複製而非直接引用，之後改動 store 不會回頭改到已匯出的內容', () => {
    const backup = createBackup(payload)
    expect(backup.tasks[0]).not.toBe(payload.tasks[0])
    expect(backup.tasks[0]?.tagIds).not.toBe(payload.tasks[0]?.tagIds)
  })
})

describe('backupFilename', () => {
  it('檔名帶本地日期，同一個資料夾裡分得出哪份是哪份', () => {
    expect(backupFilename(new Date(2030, 0, 5))).toBe('todo-list-2030-01-05.json')
  })
})

describe('parseBackup', () => {
  it('可以吃回自己匯出的字串', () => {
    const parsed = parseBackup(serializeBackup(payload))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.result.data.tasks[0]?.taskName).toBe('買牛奶')
    expect(parsed.result.data.projects[0]?.name).toBe('工作')
    expect(parsed.result.data.filters[0]?.query).toBe('today & p1')
  })

  it('不是備份檔時整份拒絕，並說明原因', () => {
    for (const [input, expected] of [
      ['{壞掉的 json', '有效的 JSON'],
      ['[]', '不是備份檔'],
      ['"字串"', '不是備份檔'],
      ['{"format":"別的東西"}', '不是本工具匯出的備份'],
    ] as const) {
      const parsed = parseBackup(input)
      expect(parsed.ok, input).toBe(false)
      if (!parsed.ok) expect(parsed.message, input).toContain(expected)
    }
  })

  it('個別壞掉的列只讓那一列消失，並回報被濾掉幾筆', () => {
    // 「這個檔案壞了」與「這幾筆救不回來」是兩件事，必須分得開
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: DB_VERSION,
        tasks: [{ id: 'a', taskName: '有效' }, null, { id: 'b' }, { taskName: '沒有 id' }],
        projects: [{ id: 'p', name: '好的' }, { id: 'q' }],
        tags: 'tags 不是陣列',
        filters: [{ id: 'f', name: '沒有查詢' }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.result.data.tasks).toHaveLength(1)
    expect(parsed.result.skipped.tasks).toBe(3)
    expect(parsed.result.skipped.projects).toBe(1)
    expect(parsed.result.data.tags, '欄位型別錯誤視為空陣列').toEqual([])
    expect(parsed.result.skipped.filters, '沒有查詢字串的篩選器是無效的').toBe(1)
  })

  it('缺少的欄位一律視為空陣列，不會因為舊檔少一個 key 就整份失敗', () => {
    const parsed = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.result.data.tasks).toEqual([])
    expect(parsed.result.data.filters).toEqual([])
  })
})

describe('mergeById', () => {
  it('同 id 以匯入的為準，其餘保留', () => {
    const merged = mergeById(
      [
        { id: 'a', v: 1 },
        { id: 'b', v: 1 },
      ],
      [
        { id: 'b', v: 2 },
        { id: 'c', v: 2 },
      ],
    )
    expect(merged).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 2 },
    ])
  })
})
