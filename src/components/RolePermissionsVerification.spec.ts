import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pinia } from 'pinia'
import type { Session } from '@supabase/auth-js'
import AppHeader from '@/components/AppHeader.vue'
import TaskItem from '@/components/TaskItem.vue'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import CollectionsDialog from '@/components/CollectionsDialog.vue'
import MembersDialog from '@/components/MembersDialog.vue'
import TaskAttachments from '@/components/TaskAttachments.vue'
import TaskComments from '@/components/TaskComments.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useAuthStore } from '@/stores/auth'
import { useAttachmentsStore } from '@/stores/attachments'
import { useCommentsStore } from '@/stores/comments'
import { freshPinia, mountWith, makeTask, testRouter } from '@/test/helpers'

function fakeSession(userId = 'u-bob', email = 'bob@example.com'): Session {
  return {
    access_token: 'token-bob',
    refresh_token: 'refresh-bob',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email },
  } as unknown as Session
}

function mockFetch(handler: (url: string) => { ok?: boolean; status?: number; data: unknown }) {
  const impl = async (url: unknown) => {
    const res = handler(String(url))
    const ok = res.ok ?? (res.status ? res.status >= 200 && res.status < 300 : true)
    const status = res.status ?? (ok ? 200 : 400)
    const text = res.data === undefined ? '' : JSON.stringify(res.data)
    return {
      ok,
      status,
      json: async () => res.data,
      text: async () => text,
    } as Response
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(impl)
  if (typeof window !== 'undefined' && 'fetch' in window) {
    vi.spyOn(window, 'fetch').mockImplementation(impl)
  }
}

describe('角色權限測試矩陣（六大核心驗證）', () => {
  let pinia: Pinia
  let router: ReturnType<typeof testRouter>

  const defaultWorkspaces = [
    { id: 'shared-ws', name: '團隊共享區', is_personal: false, created_by: 'u-alice', updated_at: 1 },
    { id: 'bob-personal', name: 'Bob 的工作區', is_personal: true, created_by: 'u-bob', updated_at: 1 },
  ]
  let currentMembers: { user_id: string; role: string; joined_at: string; profiles: { display_name: string; avatar_url: null } | null }[] = []

  beforeEach(() => {
    pinia = freshPinia()
    router = testRouter()
    localStorage.clear()
    currentMembers = []

    mockFetch((url) => {
      if (url.includes('/workspaces?')) {
        return { data: defaultWorkspaces }
      }
      if (url.includes('/workspace_members?')) {
        return { data: currentMembers }
      }
      return { data: [] }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. member：可改任務／標籤／留言／附件；不可管專案與成員
  // --------------------------------------------------------------------------
  describe('1. member 角色權限驗證', () => {
    it('member：可改任務／標籤／留言／附件；不可管專案與成員', async () => {
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'member', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      const tasks = useTasksStore()
      const collections = useCollectionsStore()
      const comments = useCommentsStore()
      const attachments = useAttachmentsStore()

      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))

      await workspace.selectWorkspace('shared-ws')
      expect(workspace.currentWorkspaceId).toBe('shared-ws')

      collections.mergeRemote({
        projects: [{ id: 'p1', name: '專案一', color: '#ff0000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'shared-ws' }],
        tags: [{ id: 'tag1', name: '標籤一', color: '#ff0000', updatedAt: 1, workspaceId: 'shared-ws' }],
        filters: [],
      })

      // 角色旗標驗證
      expect(workspace.myRole).toBe('member')
      expect(workspace.canWriteTasks).toBe(true)
      expect(workspace.canWriteCollections).toBe(true)
      expect(workspace.canComment).toBe(true)
      expect(workspace.canManageProjects).toBe(false)
      expect(workspace.canManageMembers).toBe(false)
      expect(workspace.taskWriteRestriction).toBeNull()

      // (1) 可改任務：AppHeader 快速新增可用
      const header = mountWith(AppHeader, pinia, { router })
      const quickAddInput = header.find('input[aria-label="新增代辦事項"]')
      expect(quickAddInput.exists()).toBe(true)
      await quickAddInput.setValue('由 member 新增的任務')
      await header.find('button[aria-label="新增"]').trigger('click')
      expect(tasks.items.some((t) => t.taskName === '由 member 新增的任務')).toBe(true)

      // (2) 可改任務：TaskItem 勾選、編輯、刪除、拖曳按鈕可用
      const sampleTask = makeTask('測試任務', false, { id: 'task-1', workspaceId: 'shared-ws' })
      const taskItem = mountWith(TaskItem, pinia, {
        props: { task: sampleTask, isFirst: false, isLast: false, readonly: !workspace.canWriteTasks, editing: false, dragging: false, active: false },
      })
      const checkbox = taskItem.find('input.task-complete-checkbox')
      expect(checkbox.attributes('disabled')).toBeUndefined()
      expect(taskItem.find('button[aria-label="編輯「測試任務」"]').exists()).toBe(true)
      expect(taskItem.find('button[aria-label="刪除「測試任務」"]').exists()).toBe(true)
      expect(taskItem.find('li').attributes('draggable')).toBe('true')

      // (3) 可改任務：TaskDetailForm 欄位可編輯，儲存按鈕存在
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: sampleTask } })
      expect(detailForm.find('fieldset').attributes('disabled')).toBeUndefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(true)
      expect(detailForm.text()).not.toContain('你目前是僅檢視')
      expect(detailForm.text()).not.toContain('你目前是僅留言')

      // (4) 可改標籤：CollectionsDialog 標籤名稱可編輯、刪除標籤按鈕存在、新增標籤存在
      const collectionsDialog = mountWith(CollectionsDialog, pinia, { router, props: { open: true } })
      const tagInput = collectionsDialog.find('#tag-name-tag1')
      expect(tagInput.attributes('disabled')).toBeUndefined()
      expect(collectionsDialog.find('button[aria-label="刪除標籤「標籤一」"]').exists()).toBe(true)
      expect(collectionsDialog.find('#new-tag').exists()).toBe(true)

      // (5) 可留言：TaskComments 留言輸入框與送出按鈕存在
      comments.items = []
      const commentsComponent = mountWith(TaskComments, pinia, { props: { taskId: 'task-1' } })
      expect(commentsComponent.find('#new-comment-task-1').exists()).toBe(true)
      expect(commentsComponent.find('button.bg-accent').exists()).toBe(true)

      // (6) 可改附件：TaskAttachments 上傳按鈕與刪除附件按鈕存在
      attachments.items = [{
        id: 'att-1',
        taskId: 'task-1',
        fileName: '報告.pdf',
        fileSize: 1024,
        contentType: 'application/pdf',
        storagePath: 'shared-ws/task-1/att-1.pdf',
        uploaderId: 'u-bob',
        createdAt: 1000,
        updatedAt: 1000,
      }]
      const attachmentsComponent = mountWith(TaskAttachments, pinia, { props: { taskId: 'task-1' } })
      expect(attachmentsComponent.text()).toContain('新增附件')
      expect(attachmentsComponent.findAll('button').some((b) => b.text() === '刪除')).toBe(true)

      // (7) 不可管專案：CollectionsDialog 專案輸入框與顏色選單被 disabled，刪除與複製與新增專案按鈕不存在
      const projectInput = collectionsDialog.find('#project-name-p1')
      expect(projectInput.attributes('disabled')).toBeDefined()
      const projectColorSelect = collectionsDialog.find('#project-color-p1')
      expect(projectColorSelect.attributes('disabled')).toBeDefined()
      expect(collectionsDialog.find('button[aria-label="刪除專案「專案一」"]').exists()).toBe(false)
      expect(collectionsDialog.find('button[aria-label="複製專案「專案一」"]').exists()).toBe(false)
      expect(collectionsDialog.find('#new-project').exists()).toBe(false)

      // (8) 不可管成員：MembersDialog 無角色選單、無移除成員按鈕、無邀請區塊
      const membersDialog = mountWith(MembersDialog, pinia, { props: { open: true } })
      expect(membersDialog.find('#role-u-alice').exists()).toBe(false)
      expect(membersDialog.find('button[aria-label="移除成員「Alice」"]').exists()).toBe(false)
      expect(membersDialog.find('#invite-email').exists()).toBe(false)
      expect(membersDialog.text()).not.toContain('邀請新成員')
    })
  })

  // --------------------------------------------------------------------------
  // 2. commenter：任務唯讀；可留言；不可上傳附件／改專案
  // --------------------------------------------------------------------------
  describe('2. commenter 角色權限驗證', () => {
    it('commenter：任務唯讀；可留言；不可上傳附件／改專案', async () => {
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'commenter', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      const collections = useCollectionsStore()
      const attachments = useAttachmentsStore()

      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
      await workspace.selectWorkspace('shared-ws')

      collections.mergeRemote({
        projects: [{ id: 'p1', name: '專案一', color: '#ff0000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'shared-ws' }],
        tags: [{ id: 'tag1', name: '標籤一', color: '#ff0000', updatedAt: 1, workspaceId: 'shared-ws' }],
        filters: [],
      })

      // 角色旗標驗證
      expect(workspace.myRole).toBe('commenter')
      expect(workspace.canWriteTasks).toBe(false)
      expect(workspace.canComment).toBe(true)
      expect(workspace.canManageProjects).toBe(false)
      expect(workspace.taskWriteRestriction).toBe('commenter')

      // (1) 任務唯讀：AppHeader 快速新增框不渲染，顯示權限說明
      const header = mountWith(AppHeader, pinia, { router })
      expect(header.find('input[aria-label="新增代辦事項"]').exists()).toBe(false)
      expect(header.text()).toContain('你目前是僅留言，可以留言但不能改任務')

      // (2) 任務唯讀：TaskItem 核取方塊 disabled，編輯/刪除按鈕隱藏，不可拖曳
      const sampleTask = makeTask('唯讀任務', false, { id: 'task-1', workspaceId: 'shared-ws' })
      const taskItem = mountWith(TaskItem, pinia, {
        props: { task: sampleTask, isFirst: false, isLast: false, readonly: !workspace.canWriteTasks, editing: false, dragging: false, active: false },
      })
      const checkbox = taskItem.find('input.task-complete-checkbox')
      expect(checkbox.attributes('disabled')).toBeDefined()
      expect(taskItem.find('button[aria-label="編輯「唯讀任務」"]').exists()).toBe(false)
      expect(taskItem.find('button[aria-label="刪除「唯讀任務」"]').exists()).toBe(false)
      expect(taskItem.find('li').attributes('draggable')).toBe('false')

      // (3) 任務唯讀：TaskDetailForm fieldset 被 disabled，儲存按鈕隱藏，顯示權限說明
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: sampleTask } })
      expect(detailForm.find('fieldset').attributes('disabled')).toBeDefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(false)
      expect(detailForm.text()).toContain('你目前是僅留言，可以留言但不能改任務')

      // (4) 可留言：TaskComments 留言輸入框存在，可正常留言
      const commentsComponent = mountWith(TaskComments, pinia, { props: { taskId: 'task-1' } })
      expect(commentsComponent.find('#new-comment-task-1').exists()).toBe(true)
      expect(commentsComponent.find('button.bg-accent').exists()).toBe(true)

      // (5) 不可上傳附件：TaskAttachments 無新增附件按鈕、無刪除附件按鈕（保留下載按鈕）
      attachments.items = [{
        id: 'att-1',
        taskId: 'task-1',
        fileName: '說明文件.pdf',
        fileSize: 2048,
        contentType: 'application/pdf',
        storagePath: 'shared-ws/task-1/att-1.pdf',
        uploaderId: 'u-alice',
        createdAt: 1000,
        updatedAt: 1000,
      }]
      const attachmentsComponent = mountWith(TaskAttachments, pinia, { props: { taskId: 'task-1' } })
      expect(attachmentsComponent.text()).not.toContain('新增附件')
      expect(attachmentsComponent.findAll('button').some((b) => b.text() === '刪除')).toBe(false)
      expect(attachmentsComponent.findAll('button').some((b) => b.text() === '下載')).toBe(true)

      // (6) 不可改專案：CollectionsDialog 專案名稱與顏色 disabled，無刪除/複製/新增按鈕
      const collectionsDialog = mountWith(CollectionsDialog, pinia, { router, props: { open: true } })
      expect(collectionsDialog.find('#project-name-p1').attributes('disabled')).toBeDefined()
      expect(collectionsDialog.find('#project-color-p1').attributes('disabled')).toBeDefined()
      expect(collectionsDialog.find('button[aria-label="刪除專案「專案一」"]').exists()).toBe(false)
      expect(collectionsDialog.find('button[aria-label="複製專案「專案一」"]').exists()).toBe(false)
      expect(collectionsDialog.find('#new-project').exists()).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // 3. viewer：不能新增／勾選／編輯／刪除／拖曳；無留言輸入框；有權限說明
  // --------------------------------------------------------------------------
  describe('3. viewer 角色權限驗證', () => {
    it('viewer：不能新增／勾選／編輯／刪除／拖曳；無留言輸入框；有權限說明', async () => {
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'viewer', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      const collections = useCollectionsStore()
      const attachments = useAttachmentsStore()

      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
      await workspace.selectWorkspace('shared-ws')

      collections.mergeRemote({
        projects: [{ id: 'p1', name: '專案一', color: '#ff0000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'shared-ws' }],
        tags: [{ id: 'tag1', name: '標籤一', color: '#ff0000', updatedAt: 1, workspaceId: 'shared-ws' }],
        filters: [],
      })

      // 角色旗標驗證
      expect(workspace.myRole).toBe('viewer')
      expect(workspace.canWriteTasks).toBe(false)
      expect(workspace.canComment).toBe(false)
      expect(workspace.canManageProjects).toBe(false)
      expect(workspace.taskWriteRestriction).toBe('viewer')

      // (1) 不能新增任務：AppHeader 快速新增框不存在
      const header = mountWith(AppHeader, pinia, { router })
      expect(header.find('input[aria-label="新增代辦事項"]').exists()).toBe(false)

      // (2) 有權限說明：AppHeader 明確顯示「你目前是僅檢視，只能看任務，無法編輯或留言」
      expect(header.text()).toContain('你目前是僅檢視，只能看任務，無法編輯或留言')

      // (3) 不能勾選／不能編輯／不能刪除／不能拖曳：TaskItem
      const sampleTask = makeTask('檢視任務', false, { id: 'task-1', workspaceId: 'shared-ws' })
      const taskItem = mountWith(TaskItem, pinia, {
        props: { task: sampleTask, isFirst: false, isLast: false, readonly: !workspace.canWriteTasks, editing: false, dragging: false, active: false },
      })
      // 不能勾選
      const checkbox = taskItem.find('input.task-complete-checkbox')
      expect(checkbox.attributes('disabled')).toBeDefined()
      // 不能編輯
      expect(taskItem.find('button[aria-label="編輯「檢視任務」"]').exists()).toBe(false)
      // 不能刪除
      expect(taskItem.find('button[aria-label="刪除「檢視任務」"]').exists()).toBe(false)
      // 不能拖曳
      expect(taskItem.find('li').attributes('draggable')).toBe('false')

      // (4) 不能編輯任務：TaskDetailForm fieldset 被 disabled，儲存按鈕不存在，有權限說明
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: sampleTask } })
      expect(detailForm.find('fieldset').attributes('disabled')).toBeDefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(false)
      expect(detailForm.text()).toContain('你目前是僅檢視，只能看任務，無法編輯或留言')

      // (5) 無留言輸入框：TaskComments 中輸入框完全消失
      const commentsComponent = mountWith(TaskComments, pinia, { props: { taskId: 'task-1' } })
      expect(commentsComponent.find('#new-comment-task-1').exists()).toBe(false)
      expect(commentsComponent.find('button.bg-accent').exists()).toBe(false)

      // (6) 無附件上傳/刪除按鈕（唯讀下載）
      attachments.items = [{
        id: 'att-1',
        taskId: 'task-1',
        fileName: '規格書.pdf',
        fileSize: 4096,
        contentType: 'application/pdf',
        storagePath: 'shared-ws/task-1/att-1.pdf',
        uploaderId: 'u-alice',
        createdAt: 1000,
        updatedAt: 1000,
      }]
      const attachmentsComponent = mountWith(TaskAttachments, pinia, { props: { taskId: 'task-1' } })
      expect(attachmentsComponent.text()).not.toContain('新增附件')
      expect(attachmentsComponent.findAll('button').some((b) => b.text() === '刪除')).toBe(false)
      expect(attachmentsComponent.findAll('button').some((b) => b.text() === '下載')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // 4. admin：可管專案與成員；可寫任務
  // --------------------------------------------------------------------------
  describe('4. admin 角色權限驗證', () => {
    it('admin：可管專案與成員；可寫任務', async () => {
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'admin', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
        { user_id: 'u-charlie', role: 'member', joined_at: '2026-01-03', profiles: { display_name: 'Charlie', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      const tasks = useTasksStore()
      const collections = useCollectionsStore()

      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
      await workspace.selectWorkspace('shared-ws')

      collections.mergeRemote({
        projects: [{ id: 'p1', name: '專案一', color: '#ff0000', rank: 'A', updatedAt: 1, isInbox: false, workspaceId: 'shared-ws' }],
        tags: [{ id: 'tag1', name: '標籤一', color: '#ff0000', updatedAt: 1, workspaceId: 'shared-ws' }],
        filters: [],
      })

      // 角色旗標驗證
      expect(workspace.myRole).toBe('admin')
      expect(workspace.canWriteTasks).toBe(true)
      expect(workspace.canWriteCollections).toBe(true)
      expect(workspace.canComment).toBe(true)
      expect(workspace.canManageProjects).toBe(true)
      expect(workspace.canManageMembers).toBe(true)
      expect(workspace.taskWriteRestriction).toBeNull()

      // (1) 可寫任務：AppHeader 快速新增可用
      const header = mountWith(AppHeader, pinia, { router })
      expect(header.find('input[aria-label="新增代辦事項"]').exists()).toBe(true)
      await header.find('input[aria-label="新增代辦事項"]').setValue('Admin 任務')
      await header.find('button[aria-label="新增"]').trigger('click')
      expect(tasks.items.some((t) => t.taskName === 'Admin 任務')).toBe(true)

      // (2) 可寫任務：TaskDetailForm 可編輯且儲存按鈕存在
      const sampleTask = makeTask('Admin 任務', false, { id: 'task-admin', workspaceId: 'shared-ws' })
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: sampleTask } })
      expect(detailForm.find('fieldset').attributes('disabled')).toBeUndefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(true)

      // (3) 可管專案：CollectionsDialog 專案名稱、顏色可修改，刪除、複製、新增專案按鈕全部可用
      const collectionsDialog = mountWith(CollectionsDialog, pinia, { router, props: { open: true } })
      expect(collectionsDialog.find('#project-name-p1').attributes('disabled')).toBeUndefined()
      expect(collectionsDialog.find('#project-color-p1').attributes('disabled')).toBeUndefined()
      expect(collectionsDialog.find('button[aria-label="刪除專案「專案一」"]').exists()).toBe(true)
      expect(collectionsDialog.find('button[aria-label="複製專案「專案一」"]').exists()).toBe(true)
      expect(collectionsDialog.find('#new-project').exists()).toBe(true)

      // (4) 可管成員：MembersDialog 顯示其他成員的角色選單、移除按鈕與邀請新成員表單
      const membersDialog = mountWith(MembersDialog, pinia, { props: { open: true } })
      expect(membersDialog.find('#role-u-charlie').exists()).toBe(true)
      expect(membersDialog.find('button[aria-label="移除成員「Charlie」"]').exists()).toBe(true)
      expect(membersDialog.find('#invite-email').exists()).toBe(true)
      expect(membersDialog.text()).toContain('邀請新成員')
    })
  })

  // --------------------------------------------------------------------------
  // 5. A 把 B 降權時，B 開著的分頁幾秒內鎖上（不必手動重整）
  // --------------------------------------------------------------------------
  describe('5. 即時降權鎖定驗證', () => {
    it('A 把 B 降權時，B 開著的分頁即時鎖上（不必手動重整）', async () => {
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'member', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
      await workspace.selectWorkspace('shared-ws')

      const header = mountWith(AppHeader, pinia, { router })
      const sampleTask = makeTask('進行中任務', false, { id: 'task-live', workspaceId: 'shared-ws' })
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: sampleTask } })
      const commentsComponent = mountWith(TaskComments, pinia, { props: { taskId: 'task-live' } })

      // 起初可編輯（member 身分）
      expect(workspace.canWriteTasks).toBe(true)
      expect(header.find('input[aria-label="新增代辦事項"]').exists()).toBe(true)
      expect(detailForm.find('fieldset').attributes('disabled')).toBeUndefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(true)
      expect(commentsComponent.find('#new-comment-task-live').exists()).toBe(true)

      // 模擬 Realtime 收到 A 將 B 降權為 viewer（觸發 onMembersChange / loadMembers 更新 members）
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'viewer', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]
      await workspace.loadMembers()

      // 畫面無需手動重整，響應式自動鎖上
      await header.vm.$nextTick()
      await detailForm.vm.$nextTick()
      await commentsComponent.vm.$nextTick()

      // 驗證 B 開著的分頁立刻鎖定：
      expect(workspace.canWriteTasks).toBe(false)
      expect(workspace.myRole).toBe('viewer')

      // (1) TaskDetailForm 自動鎖上 disabled，儲存按鈕消失，出現提示
      expect(detailForm.find('fieldset').attributes('disabled')).toBeDefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(false)
      expect(detailForm.text()).toContain('你目前是僅檢視，只能看任務，無法編輯或留言')

      // (2) AppHeader 快速新增輸入框消失，改為權限提示
      expect(header.find('input[aria-label="新增代辦事項"]').exists()).toBe(false)
      expect(header.text()).toContain('你目前是僅檢視，只能看任務，無法編輯或留言')

      // (3) TaskComments 留言框消失
      expect(commentsComponent.find('#new-comment-task-live').exists()).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // 6. B 在自己的個人工作區仍可完整編輯（不受共享區角色影響）
  // --------------------------------------------------------------------------
  describe('6. 個人工作區獨立權限驗證', () => {
    it('B 在自己的個人工作區仍可完整編輯（不受共享區角色影響）', async () => {
      // (1) B 在共享工作區：身分為 viewer，受限制
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'viewer', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]

      const auth = useAuthStore()
      const workspace = useWorkspaceStore()
      const tasks = useTasksStore()

      auth.session = fakeSession('u-bob')
      auth.status = 'signed-in'
      await vi.waitFor(() => expect(workspace.workspaces).toHaveLength(2))
      await workspace.selectWorkspace('shared-ws')

      expect(workspace.currentWorkspaceId).toBe('shared-ws')
      expect(workspace.myRole).toBe('viewer')
      expect(workspace.canWriteTasks).toBe(false)
      expect(workspace.canManageProjects).toBe(false)
      expect(workspace.taskWriteRestriction).toBe('viewer')

      // (2) 切換至 Bob 的個人工作區：身分切換為 owner
      currentMembers = [
        { user_id: 'u-bob', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
      ]
      await workspace.selectWorkspace('bob-personal')

      // 驗證在個人工作區中權限全部放行
      expect(workspace.currentWorkspaceId).toBe('bob-personal')
      expect(workspace.myRole).toBe('owner')
      expect(workspace.canWriteTasks).toBe(true)
      expect(workspace.canWriteCollections).toBe(true)
      expect(workspace.canManageProjects).toBe(true)
      expect(workspace.canManageMembers).toBe(true)
      expect(workspace.canComment).toBe(true)
      expect(workspace.taskWriteRestriction).toBeNull()

      // 驗證 AppHeader 正常顯示快速新增，可新增個人任務
      const header = mountWith(AppHeader, pinia, { router })
      const quickAddInput = header.find('input[aria-label="新增代辦事項"]')
      expect(quickAddInput.exists()).toBe(true)
      await quickAddInput.setValue('Bob 的個人私密任務')
      await header.find('button[aria-label="新增"]').trigger('click')
      expect(tasks.items.some((t) => t.taskName === 'Bob 的個人私密任務')).toBe(true)

      // 驗證 TaskDetailForm 正常可寫
      const personalTask = makeTask('Bob 的個人任務', false, { id: 'task-p1', workspaceId: 'bob-personal' })
      const detailForm = mountWith(TaskDetailForm, pinia, { props: { task: personalTask } })
      expect(detailForm.find('fieldset').attributes('disabled')).toBeUndefined()
      expect(detailForm.find('button[type="submit"]').exists()).toBe(true)
      expect(detailForm.text()).not.toContain('你目前是僅檢視')

      // 驗證 CollectionsDialog 可新增/管理個人專案與標籤
      const collectionsDialog = mountWith(CollectionsDialog, pinia, { router, props: { open: true } })
      expect(collectionsDialog.find('#new-project').exists()).toBe(true)
      expect(collectionsDialog.find('#new-tag').exists()).toBe(true)

      // (3) 切換回共享工作區，viewer 限制立即重新生效
      currentMembers = [
        { user_id: 'u-alice', role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: 'u-bob', role: 'viewer', joined_at: '2026-01-02', profiles: { display_name: 'Bob', avatar_url: null } },
      ]
      await workspace.selectWorkspace('shared-ws')
      expect(workspace.currentWorkspaceId).toBe('shared-ws')
      expect(workspace.myRole).toBe('viewer')
      expect(workspace.canWriteTasks).toBe(false)
      expect(workspace.canManageProjects).toBe(false)
      expect(workspace.taskWriteRestriction).toBe('viewer')
    })
  })
})
