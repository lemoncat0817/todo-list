import { describe, it, expect, beforeEach } from 'vitest'
import type { Pinia } from 'pinia'
import TaskComments from '@/components/TaskComments.vue'
import { useCommentsStore } from '@/stores/comments'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, type Wrapper } from '@/test/helpers'

/**
 * 任務留言區。作者名稱刻意不另外打 API 解析——直接借用
 * workspace.members（MembersDialog.vue 也在用同一份），這裡驗證的重點
 * 之一就是這個借用真的生效。
 */
describe('TaskComments.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    useAuthStore().session = {
      access_token: 't',
      refresh_token: 'r',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'me' },
    } as never
    useWorkspaceStore().members = [
      { user_id: 'me', role: 'owner', joined_at: '2030-01-01', profiles: { display_name: '我自己', avatar_url: null } },
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]
  })

  const mountComments = () => mountWith(TaskComments, pinia, { props: { taskId: 'task-1' } })

  it('沒有留言時顯示空狀態', () => {
    const w = mountComments()
    expect(w.text()).toContain('還沒有人留言')
  })

  it('顯示留言內容、作者名稱（自己是「我」，別人查 workspace.members）', () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'me', body: '我的留言', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
      { id: 'c2', taskId: 'task-1', authorId: 'bob', body: 'Bob 的留言', mentionedUserIds: [], createdAt: 2, updatedAt: 2 },
    ])
    const w = mountComments()

    expect(w.text()).toContain('我的留言')
    expect(w.text()).toContain('Bob 的留言')
    expect(w.text()).toContain('我')
    expect(w.text()).toContain('Bob')
  })

  it('作者已經不在 workspace.members 裡時顯示「已離開的成員」', () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'gone', body: '舊留言', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
    ])
    const w = mountComments()
    expect(w.text()).toContain('已離開的成員')
  })

  it('只在自己的留言底下顯示編輯／刪除', () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'me', body: '我的留言', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
      { id: 'c2', taskId: 'task-1', authorId: 'bob', body: 'Bob 的留言', mentionedUserIds: [], createdAt: 2, updatedAt: 2 },
    ])
    const w = mountComments()
    const items = w.findAll('li')
    expect(items[0]?.text()).toContain('編輯')
    expect(items[1]?.text()).not.toContain('編輯')
  })

  it('輸入內容並按「留言」會呼叫 comments.add，送出後清空輸入框', async () => {
    const w = mountComments()
    const textarea = w.find('#new-comment-task-1')
    await textarea.setValue('新留言')

    const submit = w.findAll('button').find((b) => b.text() === '留言')
    await submit?.trigger('click')

    const comments = useCommentsStore()
    expect(comments.forTask('task-1').map((c) => c.body)).toContain('新留言')
    expect((w.find('#new-comment-task-1').element as HTMLTextAreaElement).value).toBe('')
  })

  it('編輯自己的留言：點編輯出現輸入框，儲存後呼叫 comments.update', async () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'me', body: '原始內容', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
    ])
    const w = mountComments()

    const editButton = w.findAll('button').find((b) => b.text() === '編輯')
    await editButton?.trigger('click')

    const editTextarea = w.find(`#edit-comment-c1`)
    expect((editTextarea.element as HTMLTextAreaElement).value).toBe('原始內容')
    await editTextarea.setValue('改過的內容')

    const saveButton = w.findAll('button').find((b) => b.text() === '儲存')
    await saveButton?.trigger('click')

    expect(comments.forTask('task-1')[0]?.body).toBe('改過的內容')
  })

  it('刪除自己的留言：點刪除呼叫 comments.remove', async () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'me', body: '要刪掉的', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
    ])
    const w: Wrapper = mountComments()

    const deleteButton = w.findAll('button').find((b) => b.text() === '刪除')
    await deleteButton?.trigger('click')

    expect(comments.forTask('task-1')).toEqual([])
  })

  it('留言內容裡的 @提及會標示成醒目樣式', () => {
    const comments = useCommentsStore()
    comments.mergeRemote([
      { id: 'c1', taskId: 'task-1', authorId: 'me', body: '@Bob 麻煩看一下', mentionedUserIds: ['bob'], createdAt: 1, updatedAt: 1 },
    ])
    const w = mountComments()

    const mention = w.find('.bg-accent-soft')
    expect(mention.exists()).toBe(true)
    expect(mention.text()).toBe('@Bob')
  })

  it('送出的留言帶 @提及時，comments.add 收到的內容會解析出 mentionedUserIds', async () => {
    const w = mountComments()
    await w.find('#new-comment-task-1').setValue('@Bob 麻煩確認')

    const submit = w.findAll('button').find((b) => b.text() === '留言')
    await submit?.trigger('click')

    const comments = useCommentsStore()
    expect(comments.forTask('task-1')[0]?.mentionedUserIds).toEqual(['bob'])
  })
})
