import { describe, it, expect } from 'vitest'
import { inCurrentWorkspace } from './workspaceScope'

describe('inCurrentWorkspace', () => {
  it('currentWorkspaceId 為 null 時一律看得到（純本機模式／尚未登入）', () => {
    expect(inCurrentWorkspace({ workspaceId: 'w1' }, null)).toBe(true)
    expect(inCurrentWorkspace({ workspaceId: null }, null)).toBe(true)
  })

  it('workspaceId 相符時看得到', () => {
    expect(inCurrentWorkspace({ workspaceId: 'w1' }, 'w1')).toBe(true)
  })

  it('workspaceId 屬於別的工作區時看不到', () => {
    expect(inCurrentWorkspace({ workspaceId: 'w2' }, 'w1')).toBe(false)
  })

  it('workspaceId 是 null（還沒同步過）時，不管目前在哪個工作區都看得到', () => {
    expect(inCurrentWorkspace({ workspaceId: null }, 'w1')).toBe(true)
  })
})
