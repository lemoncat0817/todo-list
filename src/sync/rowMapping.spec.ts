import { describe, it, expect } from 'vitest'
import {
  fromRemoteFilter,
  fromRemoteProject,
  fromRemoteTag,
  fromRemoteTask,
  isTombstone,
  makeTombstone,
  toRemoteFilter,
  toRemoteProject,
  toRemoteTag,
  toRemoteTask,
} from './rowMapping'
import { normalizeFilter, normalizeProject, normalizeTag, normalizeTask } from '@/domain/task'
import { makeTask } from '@/test/helpers'

/**
 * 這裡驗證的是一個往返：本地物件 → 遠端 JSON body → （模擬從伺服器讀回來）
 * → 改名回 camelCase → 過 normalize* → 應該拿回等價的本地物件。
 * 這條路徑就是 push 之後緊接著 pull 會實際發生的事。
 */
describe('rowMapping — tasks', () => {
  it('推送不帶 user_id——由資料庫的 default auth.uid() 決定', () => {
    const task = makeTask('買牛奶')
    expect(Object.keys(toRemoteTask(task))).not.toContain('user_id')
  })

  it('本地 → 遠端 → 本地 是等價的', () => {
    const task = makeTask('交報告', false, {
      notes: '備註',
      priority: 3,
      dueDate: '2030-01-15',
      dueTime: '09:00',
      projectId: 'p1',
      tagIds: ['t1', 't2'],
      parentId: null,
      recurrence: { freq: 'daily', interval: 1, byDay: [], byMonthDay: null, until: null, count: null },
    })
    const roundTripped = normalizeTask(fromRemoteTask(toRemoteTask(task)))
    expect(roundTripped).toEqual(task)
  })
})

describe('rowMapping — projects／tags／filters', () => {
  it('專案往返等價（含 workspaceId）', () => {
    const project = {
      id: 'p1',
      name: '工作',
      color: '#1d4ed8',
      rank: 'C',
      updatedAt: 1000,
      isInbox: false,
      workspaceId: 'w1',
    }
    expect(normalizeProject(fromRemoteProject(toRemoteProject(project)))).toEqual(project)
  })

  it('is_inbox 只拉不推：伺服器回傳的收件匣旗標會被讀進來，但 toRemoteProject 不會送出這個欄位', () => {
    expect(
      toRemoteProject({
        id: 'p1',
        name: '收件匣',
        color: '#6b7280',
        rank: 'A',
        updatedAt: 1000,
        isInbox: true,
        workspaceId: 'w1',
      }),
    ).not.toHaveProperty('is_inbox')

    const remoteRow = { id: 'p1', name: '收件匣', color: '#6b7280', rank: 'A', updated_at: 1000, is_inbox: true }
    expect(normalizeProject(fromRemoteProject(remoteRow))?.isInbox).toBe(true)
  })

  it('workspace_id 建立時明確送出：共享工作區底下新建專案唯一的路徑', () => {
    expect(
      toRemoteProject({
        id: 'p1',
        name: '共享專案',
        color: '#1d4ed8',
        rank: 'A',
        updatedAt: 1000,
        isInbox: false,
        workspaceId: 'shared-ws',
      }),
    ).toMatchObject({ workspace_id: 'shared-ws' })
  })

  it('標籤往返等價（含 workspaceId）', () => {
    const tag = { id: 'g1', name: '緊急', color: '#15803d', updatedAt: 1000, workspaceId: 'w1' }
    expect(normalizeTag(fromRemoteTag(toRemoteTag(tag)))).toEqual(tag)
  })

  it('篩選器往返等價（含 workspaceId）', () => {
    const filter = {
      id: 'f1',
      name: '要事',
      query: 'today & p1',
      color: '#7c3aed',
      rank: 'A',
      updatedAt: 1000,
      workspaceId: 'w1',
    }
    expect(normalizeFilter(fromRemoteFilter(toRemoteFilter(filter)))).toEqual(filter)
  })
})

describe('墓碑', () => {
  it('makeTombstone 帶上現在的時間，deleted_at／updated_at 都要有', () => {
    const before = Date.now()
    const tomb = makeTombstone('a')
    expect(tomb.id).toBe('a')
    expect(tomb.deleted_at).toBeGreaterThanOrEqual(before)
    // updated_at 沒有的話，別的裝置的 pull（走 updated_at > 游標）永遠拉不到
    // 這筆墓碑——這筆刪除就永遠不會同步過去，是實測踩到的臭蟲，見常數旁註解。
    expect(tomb.updated_at).toBeGreaterThanOrEqual(before)
  })

  it('isTombstone 只看 deleted_at 是不是數字', () => {
    expect(isTombstone({ deleted_at: 123 })).toBe(true)
    expect(isTombstone({ deleted_at: null })).toBe(false)
    expect(isTombstone({})).toBe(false)
  })
})
