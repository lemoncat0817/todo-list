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
    becomeWorkspaceMember('ws-a', 'admin')
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

describe('importBackup — 工作區範圍對齊與清洗', () => {
  it('匯入無 workspaceId 之備份檔時，所有任務與專案均自動歸屬至當前工作區', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [
          makeTask('無 workspace 任務', false, { id: 't-null', workspaceId: null }),
          makeTask('其他 workspace 任務', false, { id: 't-other', workspaceId: 'ws-b' }),
        ],
        projects: [
          { id: 'proj-new', name: '新專案', color: '#111', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: null },
        ],
        tags: [
          { id: 'tag-1', name: '標籤', color: '#222', updatedAt: 1, workspaceId: null },
        ],
        filters: [
          { id: 'f-1', name: '篩選', query: 'p1', color: '#333', rank: '0', updatedAt: 1, workspaceId: null },
        ],
      },
      'merge',
    )

    const importedT1 = tasks.items.find((t) => t.id === 't-null')
    const importedT2 = tasks.items.find((t) => t.id === 't-other')
    const importedProj = collections.projects.find((p) => p.id === 'proj-new')
    const importedTag = collections.tags.find((t) => t.id === 'tag-1')
    const importedFilter = collections.filters.find((f) => f.id === 'f-1')

    expect(importedT1?.workspaceId).toBe('ws-a')
    expect(importedT2?.workspaceId).toBe('ws-a')
    expect(importedProj?.workspaceId).toBe('ws-a')
    expect(importedTag?.workspaceId).toBe('ws-a')
    expect(importedFilter?.workspaceId).toBe('ws-a')
  })

  it('備份中的舊收件匣專案不被重複匯入，舊收件匣任務重新對齊至當前工作區收件匣', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [
          makeTask('原本無專案任務', false, { id: 't-none', projectId: null }),
          makeTask('舊收件匣任務', false, { id: 't-old-inbox', projectId: 'backup-inbox-id' }),
        ],
        projects: [
          { id: 'backup-inbox-id', name: '收件匣', color: '#000', rank: '0', updatedAt: 1, isInbox: true, workspaceId: null },
        ],
        tags: [],
        filters: [],
      },
      'merge',
    )

    // 不會匯入第二個收件匣專案
    expect(collections.projects.some((p) => p.id === 'backup-inbox-id')).toBe(false)

    // 兩筆任務的 projectId 均被對齊到 inbox-a
    expect(tasks.items.find((t) => t.id === 't-none')?.projectId).toBe('inbox-a')
    expect(tasks.items.find((t) => t.id === 't-old-inbox')?.projectId).toBe('inbox-a')
  })

  it('一般 member 匯入含有新專案之備份時，新專案被略過且任務安全回退至收件匣', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'member')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
      { id: 'proj-exist', name: '既有專案', color: '#111', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [
          makeTask('指向既有專案之任務', false, { id: 't-exist', projectId: 'proj-exist' }),
          makeTask('指向新專案之任務', false, { id: 't-new', projectId: 'proj-unauthorized' }),
        ],
        projects: [
          { id: 'proj-unauthorized', name: '無權建立的專案', color: '#222', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: null },
        ],
        tags: [],
        filters: [],
      },
      'merge',
    )

    // 新專案未被建立
    expect(collections.projects.some((p) => p.id === 'proj-unauthorized')).toBe(false)

    // 任務 t-exist 保留在 proj-exist；t-new 降級至 inbox-a
    expect(tasks.items.find((t) => t.id === 't-exist')?.projectId).toBe('proj-exist')
    expect(tasks.items.find((t) => t.id === 't-new')?.projectId).toBe('inbox-a')
  })

  it('任務指派對象非當前工作區成員時，assigneeId 自動清洗為 null', () => {
    const { tasks, collections, workspace } = setup()
    becomeWorkspaceMember('ws-a', 'admin', 'user-me')
    workspace.members = [
      { user_id: 'user-me', role: 'admin', joined_at: '', profiles: { display_name: 'Me', avatar_url: null } },
      { user_id: 'user-colleague', role: 'member', joined_at: '', profiles: { display_name: 'Colleague', avatar_url: null } },
    ]
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [
          makeTask('有效指派', false, { id: 't-valid', assigneeId: 'user-colleague' }),
          makeTask('外部指派', false, { id: 't-foreign', assigneeId: 'user-stranger' }),
        ],
        projects: [],
        tags: [],
        filters: [],
      },
      'merge',
    )

    expect(tasks.items.find((t) => t.id === 't-valid')?.assigneeId).toBe('user-colleague')
    expect(tasks.items.find((t) => t.id === 't-foreign')?.assigneeId).toBeNull()
  })

  it('取代（replace）模式下，當前工作區的收件匣專案不會被清空', () => {
    const { tasks, collections } = setup()
    becomeWorkspaceMember('ws-a', 'admin')
    collections.projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
      { id: 'proj-old', name: '舊專案', color: '#111', rank: 'B', updatedAt: 1, isInbox: false, workspaceId: 'ws-a' },
    ]

    tasks.importBackup(
      {
        tasks: [],
        projects: [
          { id: 'proj-new', name: '新專案', color: '#222', rank: 'C', updatedAt: 2, isInbox: false, workspaceId: null },
        ],
        tags: [],
        filters: [],
      },
      'replace',
    )

    const projectIds = collections.projects.map((p) => p.id)
    // proj-old 被取代清空，proj-new 被匯入，但 inbox-a 必須依然存在
    expect(projectIds).toContain('inbox-a')
    expect(projectIds).toContain('proj-new')
    expect(projectIds).not.toContain('proj-old')
  })
})

