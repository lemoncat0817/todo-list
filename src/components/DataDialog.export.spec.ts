import { describe, it, expect, vi, afterEach } from 'vitest'
import DataDialog from '@/components/DataDialog.vue'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, makeTask, becomeWorkspaceMember } from '@/test/helpers'

/**
 * M6 補做：匯出範圍改成只含目前所在的工作區。獨立成一支檔案——既有的
 * 匯出/匯入/到期提醒沒有專屬測試檔，這裡只補新增的「工作區範圍」這件事。
 */
async function exportedTasks(w: ReturnType<typeof mountWith>): Promise<string[]> {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const button = w.findAll('button').find((b) => b.text() === '匯出 JSON')
  await button?.trigger('click')

  const blob = createObjectURL.mock.calls[0]?.[0] as Blob
  const json = JSON.parse(await blob.text()) as { tasks: { id: string }[] }
  return json.tasks.map((t) => t.id)
}

afterEach(() => vi.restoreAllMocks())

describe('DataDialog.vue — 匯出範圍（純本機，沒有工作區概念）', () => {
  it('匯出全部任務——跟改之前行為一致', async () => {
    const pinia = freshPinia()
    useTasksStore().items = [
      makeTask('A', false, { id: 'a', workspaceId: null }),
      makeTask('B', false, { id: 'b', workspaceId: null }),
    ]
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    const ids = await exportedTasks(w)
    expect(ids.sort()).toEqual(['a', 'b'])
  })
})

describe('DataDialog.vue — 匯出範圍（有目前工作區）', () => {
  it('只匯出目前工作區的任務', async () => {
    const pinia = freshPinia()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'ws-a'
    useTasksStore().items = [
      makeTask('工作區 A 的任務', false, { id: 'a', workspaceId: 'ws-a' }),
      makeTask('工作區 B 的任務', false, { id: 'b', workspaceId: 'ws-b' }),
    ]
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    const ids = await exportedTasks(w)
    expect(ids).toEqual(['a'])
  })

  it('顯示的任務數也跟著只算目前工作區', () => {
    const pinia = freshPinia()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'ws-a'
    useTasksStore().items = [
      makeTask('工作區 A 的任務', false, { id: 'a', workspaceId: 'ws-a' }),
      makeTask('工作區 B 的任務', false, { id: 'b', workspaceId: 'ws-b' }),
    ]
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    expect(w.text()).toContain('目前 1 筆任務')
  })

  it('收件匣專案也包含在匯出範圍內——不然還原回來的任務會找不到收件匣', async () => {
    const pinia = freshPinia()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'ws-a'
    useCollectionsStore().projects = [
      { id: 'inbox-a', name: '收件匣', color: '#000', rank: 'A', updatedAt: 1, isInbox: true, workspaceId: 'ws-a' },
    ]
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const button = w.findAll('button').find((b) => b.text() === '匯出 JSON')
    await button?.trigger('click')

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    const json = JSON.parse(await blob.text()) as { projects: { id: string }[] }
    expect(json.projects.map((p) => p.id)).toEqual(['inbox-a'])
  })

  it('標籤與篩選器也只匯出目前工作區', async () => {
    const pinia = freshPinia()
    const workspace = useWorkspaceStore()
    workspace.currentWorkspaceId = 'ws-a'
    const collections = useCollectionsStore()
    collections.tags = [
      { id: 'tag-a', name: '標籤A', color: '#f00', updatedAt: 1, workspaceId: 'ws-a' },
      { id: 'tag-b', name: '標籤B', color: '#0f0', updatedAt: 1, workspaceId: 'ws-b' },
    ]
    collections.filters = [
      { id: 'f-a', name: '篩選器A', query: 'p1', color: '#000', rank: '0', updatedAt: 1, workspaceId: 'ws-a' },
      { id: 'f-b', name: '篩選器B', query: 'p2', color: '#000', rank: '1', updatedAt: 1, workspaceId: 'ws-b' },
    ]
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const button = w.findAll('button').find((b) => b.text() === '匯出 JSON')
    await button?.trigger('click')

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    const json = JSON.parse(await blob.text()) as {
      tags: { id: string }[]
      filters: { id: string }[]
    }
    expect(json.tags.map((t) => t.id)).toEqual(['tag-a'])
    expect(json.filters.map((f) => f.id)).toEqual(['f-a'])
  })
})

describe('DataDialog.vue — viewer／無權限時匯入入口隱藏', () => {
  it('viewer 身分時，還原區塊與匯入按鈕隱藏', () => {
    const pinia = freshPinia()
    becomeWorkspaceMember('ws-a', 'viewer')
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    expect(w.text()).not.toContain('還原')
    expect(w.find('#import-file').exists()).toBe(false)
  })

  it('member 身分時，顯示還原區塊與匯入按鈕', () => {
    const pinia = freshPinia()
    becomeWorkspaceMember('ws-a', 'member')
    const w = mountWith(DataDialog, pinia, { props: { open: true } })

    expect(w.text()).toContain('還原')
    expect(w.find('#import-file').exists()).toBe(true)
  })
})

