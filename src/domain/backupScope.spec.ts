import { describe, it, expect } from 'vitest'
import { scopeBackupToWorkspace } from './backupScope'
import type { StoredFilter, StoredProject, StoredTag, StoredTask } from '@/db/schema'
import { makeTask } from '@/test/helpers'

function sampleBackup() {
  const tasks: StoredTask[] = [
    makeTask('未分類任務', false, { id: 't-uncat', projectId: null, workspaceId: null }),
    makeTask('舊收件匣任務', false, { id: 't-inbox', projectId: 'old-inbox', workspaceId: null }),
    makeTask('專案1任務', false, {
      id: 't-proj1',
      projectId: 'proj-1',
      workspaceId: null,
      assigneeId: 'user-valid',
      sectionId: 'sec-valid',
    }),
    makeTask('外部成員任務', false, {
      id: 't-proj2',
      projectId: 'proj-1',
      workspaceId: null,
      assigneeId: 'user-foreign',
      sectionId: 'sec-invalid',
    }),
  ]

  const projects: StoredProject[] = [
    { id: 'old-inbox', name: '收件匣', color: '#000', rank: '0', updatedAt: 100, isInbox: true, workspaceId: null },
    { id: 'proj-1', name: '專案一', color: '#111', rank: '1', updatedAt: 100, isInbox: false, workspaceId: null },
    { id: 'proj-2', name: '專案二', color: '#222', rank: '2', updatedAt: 100, isInbox: false, workspaceId: null },
  ]

  const tags: StoredTag[] = [
    { id: 'tag-1', name: '標籤1', color: '#333', updatedAt: 100, workspaceId: null },
  ]

  const filters: StoredFilter[] = [
    { id: 'f-1', name: '篩選1', query: 'p1', color: '#444', rank: '0', updatedAt: 100, workspaceId: null },
  ]

  return { tasks, projects, tags, filters }
}

describe('scopeBackupToWorkspace', () => {
  it('純本地模式（currentWorkspaceId === null）直接回傳原始資料', () => {
    const raw = sampleBackup()
    const result = scopeBackupToWorkspace(raw, { currentWorkspaceId: null })
    expect(result).toBe(raw)
  })

  it('指定工作區時，覆寫所有 workspaceId 為目前工作區 ID', () => {
    const raw = sampleBackup()
    const result = scopeBackupToWorkspace(raw, {
      currentWorkspaceId: 'ws-target',
      targetInboxId: 'target-inbox',
      canManageProjects: true,
      validMemberIds: new Set(['user-valid']),
      existingProjectIds: new Set(),
      validSectionIds: new Set(['sec-valid']),
      now: 2000,
    })

    expect(result.projects.every((p) => p.workspaceId === 'ws-target')).toBe(true)
    expect(result.tags.every((t) => t.workspaceId === 'ws-target')).toBe(true)
    expect(result.filters.every((f) => f.workspaceId === 'ws-target')).toBe(true)
    expect(result.tasks.every((t) => t.workspaceId === 'ws-target')).toBe(true)
  })

  it('排除備份中的收件匣專案，並將原收件匣任務重定向至目標工作區收件匣', () => {
    const raw = sampleBackup()
    const result = scopeBackupToWorkspace(raw, {
      currentWorkspaceId: 'ws-target',
      targetInboxId: 'target-inbox',
      canManageProjects: true,
      validMemberIds: new Set(['user-valid']),
      existingProjectIds: new Set(),
      validSectionIds: new Set(['sec-valid']),
      now: 2000,
    })

    // 備份中的 old-inbox 被過濾掉
    expect(result.projects.some((p) => p.isInbox)).toBe(false)
    expect(result.projects.map((p) => p.id)).toEqual(['proj-1', 'proj-2'])

    // 未分類任務與指向 old-inbox 的任務，都重定向到 target-inbox
    const uncatTask = result.tasks.find((t) => t.id === 't-uncat')
    const inboxTask = result.tasks.find((t) => t.id === 't-inbox')
    expect(uncatTask?.projectId).toBe('target-inbox')
    expect(inboxTask?.projectId).toBe('target-inbox')
  })

  it('無管理專案權限（canManageProjects: false）時，排除新專案，相關任務回退至收件匣', () => {
    const raw = sampleBackup()
    // 假設 proj-2 已經在工作區中存在，proj-1 是新專案
    const result = scopeBackupToWorkspace(raw, {
      currentWorkspaceId: 'ws-target',
      targetInboxId: 'target-inbox',
      canManageProjects: false,
      validMemberIds: new Set(['user-valid']),
      existingProjectIds: new Set(['proj-2']),
      validSectionIds: new Set(['sec-valid']),
      now: 2000,
    })

    // 只有既有專案 proj-2 被保留，proj-1 因為無權限建立被略過
    expect(result.projects.map((p) => p.id)).toEqual(['proj-2'])

    // 原本屬於 proj-1 的任務，因為 proj-1 無法被建立，回退至 target-inbox
    const proj1Task = result.tasks.find((t) => t.id === 't-proj1')
    expect(proj1Task?.projectId).toBe('target-inbox')
  })

  it('清洗不在目標工作區成員名單的 assigneeId 與無效的 sectionId', () => {
    const raw = sampleBackup()
    const result = scopeBackupToWorkspace(raw, {
      currentWorkspaceId: 'ws-target',
      targetInboxId: 'target-inbox',
      canManageProjects: true,
      validMemberIds: new Set(['user-valid']),
      existingProjectIds: new Set(),
      validSectionIds: new Set(['sec-valid']),
      now: 2000,
    })

    const validTask = result.tasks.find((t) => t.id === 't-proj1')
    expect(validTask?.assigneeId).toBe('user-valid')
    expect(validTask?.sectionId).toBe('sec-valid')

    const foreignTask = result.tasks.find((t) => t.id === 't-proj2')
    expect(foreignTask?.assigneeId).toBeNull()
    expect(foreignTask?.sectionId).toBeNull()
  })

  it('確保 updatedAt 推進為目前時間戳記', () => {
    const raw = sampleBackup()
    const result = scopeBackupToWorkspace(raw, {
      currentWorkspaceId: 'ws-target',
      targetInboxId: 'target-inbox',
      canManageProjects: true,
      validMemberIds: new Set(),
      existingProjectIds: new Set(),
      validSectionIds: new Set(),
      now: 5000,
    })

    expect(result.tasks.every((t) => t.updatedAt >= 5000)).toBe(true)
    expect(result.projects.every((p) => p.updatedAt >= 5000)).toBe(true)
    expect(result.tags.every((t) => t.updatedAt >= 5000)).toBe(true)
    expect(result.filters.every((f) => f.updatedAt >= 5000)).toBe(true)
  })
})
