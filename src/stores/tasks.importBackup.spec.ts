import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { makeTask, becomeWorkspaceMember } from '@/test/helpers'

/**
 * M6 補做：備份匯出範圍改成只含目前工作區之後，「取代」模式不能再是
 * 全部清空——那會連別的工作區在本機的快取也一起清掉。獨立成一支檔案
 * ——tasks.spec.ts 本來就沒有 importBackup 的測試（這是第一次補上），
 * 不是照慣例拆檔，是原本就缺。
 */
function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return {
    tasks: useTasksStore(),
    collections: useCollectionsStore(),
    workspace: useWorkspaceStore(),
    history: useHistoryStore(),
  }
}

beforeEach(() => localStorage.clear())

describe('importBackup — replace 模式（純本機，currentWorkspaceId 為 null）', () => {
  it('沒有目前工作區概念時，取代維持既有行為：全部換掉', () => {
    const { tasks } = setup()
    tasks.items = [makeTask('舊的', false, { id: 'old' })]

    tasks.importBackup(
      { tasks: [makeTask('新的', false, { id: 'new' })], projects: [], tags: [], filters: [] },
      'replace',
    )

    expect(tasks.items.map((t) => t.id)).toEqual(['new'])
  })
})

describe('importBackup — replace 模式（有目前工作區）', () => {
  it('只清空目前工作區的任務，其他工作區的任務原封不動', () => {
    const { tasks } = setup()
    becomeWorkspaceMember('ws-a')
    tasks.items = [
      makeTask('工作區 A 的舊任務', false, { id: 'a-old', workspaceId: 'ws-a' }),
      makeTask('工作區 B 的任務', false, { id: 'b-task', workspaceId: 'ws-b' }),
    ]

    tasks.importBackup(
      { tasks: [makeTask('工作區 A 的新任務', false, { id: 'a-new', workspaceId: 'ws-a' })], projects: [], tags: [], filters: [] },
      'replace',
    )

    const ids = tasks.items.map((t) => t.id).sort()
    expect(ids).toEqual(['a-new', 'b-task'])
  })

  it('可以復原：取代前的完整狀態（含其他工作區）都回來', () => {
    const { tasks, history } = setup()
    becomeWorkspaceMember('ws-a')
    tasks.items = [
      makeTask('工作區 A 的舊任務', false, { id: 'a-old', workspaceId: 'ws-a' }),
      makeTask('工作區 B 的任務', false, { id: 'b-task', workspaceId: 'ws-b' }),
    ]

    tasks.importBackup(
      { tasks: [makeTask('新的', false, { id: 'a-new', workspaceId: 'ws-a' })], projects: [], tags: [], filters: [] },
      'replace',
    )
    expect(tasks.items.map((t) => t.id).sort()).toEqual(['a-new', 'b-task'])

    history.undo()

    expect(tasks.items.map((t) => t.id).sort()).toEqual(['a-old', 'b-task'])
  })

  it('合併模式不受工作區範圍調整影響——本來就不會清掉任何既有資料', () => {
    const { tasks } = setup()
    becomeWorkspaceMember('ws-a')
    tasks.items = [
      makeTask('工作區 A 的任務', false, { id: 'a-1', workspaceId: 'ws-a' }),
      makeTask('工作區 B 的任務', false, { id: 'b-1', workspaceId: 'ws-b' }),
    ]

    tasks.importBackup(
      { tasks: [makeTask('新增的', false, { id: 'a-2', workspaceId: 'ws-a' })], projects: [], tags: [], filters: [] },
      'merge',
    )

    const ids = tasks.items.map((t) => t.id).sort()
    expect(ids).toEqual(['a-1', 'a-2', 'b-1'])
  })
})

describe('collections applyImport — replace 模式（有目前工作區）', () => {
  it('只清空目前工作區的專案／標籤／篩選器，其他工作區原封不動', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a')
    collections.projects = [
      { id: 'a-proj', name: 'A 的專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'ws-a' },
      { id: 'b-proj', name: 'B 的專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'ws-b' },
    ]

    tasks.importBackup(
      {
        tasks: [],
        projects: [
          { id: 'a-proj-new', name: '新的 A 專案', color: '#000', rank: 'A', updatedAt: 2, isInbox: false, workspaceId: 'ws-a' },
        ],
        tags: [],
        filters: [],
      },
      'replace',
    )

    const ids = collections.projects.map((p) => p.id).sort()
    expect(ids).toEqual(['a-proj-new', 'b-proj'])
  })
})

describe('importBackup — 權限防護（viewer／無權限）', () => {
  it('viewer 身分呼叫 importBackup 時無效，任務與專案皆不被修改', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'viewer')
    tasks.items = [makeTask('原本任務', false, { id: 'orig-t', workspaceId: 'ws-a' })]
    collections.projects = [
      { id: 'orig-p', name: '原本專案', color: '#000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [makeTask('新任務', false, { id: 'new-t', workspaceId: 'ws-a' })],
        projects: [
          { id: 'new-p', name: '新專案', color: '#000', rank: 'A', updatedAt: 2, isInbox: false, workspaceId: 'ws-a' },
        ],
        tags: [],
        filters: [],
      },
      'replace',
    )

    expect(tasks.items.map((t) => t.id)).toEqual(['orig-t'])
    expect(collections.projects.map((p) => p.id)).toEqual(['orig-p'])
  })
})

