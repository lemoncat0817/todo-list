import { describe, it, expect } from 'vitest'
import {
  canWriteTasks,
  canComment,
  canManageProjects,
  canManageMembers,
} from './workspaceRole'

describe('沒有工作區脈絡時（純本機／尚未登入）', () => {
  it('任務／專案都放行，成員管理則否——沒有工作區就沒有成員可管', () => {
    expect(canWriteTasks(null, null)).toBe(true)
    expect(canComment(null, null)).toBe(true)
    expect(canManageProjects(null, null)).toBe(true)
    expect(canManageMembers(null, null)).toBe(false)
  })
})

describe('在某個工作區裡', () => {
  it('owner／admin／member 可以改任務，commenter／viewer 不行', () => {
    expect(canWriteTasks('owner', 'w1')).toBe(true)
    expect(canWriteTasks('admin', 'w1')).toBe(true)
    expect(canWriteTasks('member', 'w1')).toBe(true)
    expect(canWriteTasks('commenter', 'w1')).toBe(false)
    expect(canWriteTasks('viewer', 'w1')).toBe(false)
  })

  it('commenter 可以留言，viewer 不行', () => {
    expect(canComment('commenter', 'w1')).toBe(true)
    expect(canComment('member', 'w1')).toBe(true)
    expect(canComment('viewer', 'w1')).toBe(false)
  })

  it('只有 owner／admin 能管專案與成員', () => {
    expect(canManageProjects('owner', 'w1')).toBe(true)
    expect(canManageProjects('member', 'w1')).toBe(false)
    expect(canManageMembers('admin', 'w1')).toBe(true)
    expect(canManageMembers('member', 'w1')).toBe(false)
  })

  it('角色還沒載到時先當不能寫，避免僅檢視者在空窗裡先改一筆', () => {
    expect(canWriteTasks(null, 'w1')).toBe(false)
    expect(canComment(null, 'w1')).toBe(false)
  })
})
