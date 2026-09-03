import { describe, it, expect } from 'vitest'
import type { Op } from '@/db/schema'
import { pendingDeleteIdsForTable } from './outboxSync'

const op = (kind: Op['kind'], targetId: string): Op => ({
  id: `op-${targetId}`,
  kind,
  targetId,
  payload: { deleted_at: 1 },
  createdAt: 1,
  attempts: 0,
})

describe('pendingDeleteIdsForTable', () => {
  it('只回傳指定表的 *.delete targetId', () => {
    const ops = [op('tag.delete', 't1'), op('tag.patch', 't2'), op('task.delete', 'task-1'), op('tag.delete', 't3')]
    expect(pendingDeleteIdsForTable(ops, 'tags')).toEqual(['t1', 't3'])
    expect(pendingDeleteIdsForTable(ops, 'tasks')).toEqual(['task-1'])
  })

  it('沒有對應刪除 kind 的表回傳空陣列', () => {
    expect(pendingDeleteIdsForTable([op('tag.delete', 't1')], 'notifications')).toEqual([])
  })
})
