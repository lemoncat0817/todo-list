import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { useSectionsStore } from '@/stores/sections'
import { useCommentsStore } from '@/stores/comments'
import { useHistoryStore } from '@/stores/history'
import { makeTask } from '@/test/helpers'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return {
    tasks: useTasksStore(),
    collections: useCollectionsStore(),
    sections: useSectionsStore(),
    comments: useCommentsStore(),
    history: useHistoryStore(),
  }
}

beforeEach(() => localStorage.clear())

describe('tasks store — duplicateProject（M5：專案範本）', () => {
  it('不存在的專案回傳 null，什麼都不做', () => {
    const { tasks } = setup()
    expect(tasks.duplicateProject('沒有這個專案')).toBeNull()
  })

  it('建立一個新專案，名稱加上「的副本」', () => {
    const { tasks, collections } = setup()
    const source = collections.addProject('工作')
    const copy = tasks.duplicateProject(source.id)
    expect(copy?.name).toBe('工作 的副本')
    expect(copy?.id).not.toBe(source.id)
  })

  it('只複製未完成的頂層任務，帶著備註／優先度／標籤／重複規則，但不帶到期日與指派對象，也不帶留言', () => {
    const { tasks, collections, comments } = setup()
    const source = collections.addProject('工作')
    const tag = collections.addTag('緊急')
    tasks.items = [
      makeTask('未完成的事', false, {
        id: 't1', projectId: source.id, notes: '備註內容', priority: 2, tagIds: [tag.id],
        dueDate: '2030-01-01', dueTime: '09:00', assigneeId: 'bob',
        recurrence: { freq: 'daily', interval: 1, byDay: [], byMonthDay: null, until: null, count: null },
      }),
      makeTask('已完成的事', true, { id: 't2', projectId: source.id }),
    ]
    comments.items = [
      { id: 'c1', taskId: 't1', body: '留言內容', authorId: 'u1', mentionedUserIds: [], createdAt: 1, updatedAt: 1 },
    ]

    const copy = tasks.duplicateProject(source.id)
    const copiedTasks = tasks.items.filter((t) => t.projectId === copy?.id)

    expect(copiedTasks).toHaveLength(1)
    const copied = copiedTasks[0]!
    expect(copied.taskName).toBe('未完成的事')
    expect(copied.notes).toBe('備註內容')
    expect(copied.priority).toBe(2)
    expect(copied.tagIds).toEqual([tag.id])
    expect(copied.recurrence).toEqual({ freq: 'daily', interval: 1, byDay: [], byMonthDay: null, until: null, count: null })
    expect(copied.dueDate).toBeNull()
    expect(copied.dueTime).toBeNull()
    expect(copied.assigneeId).toBeNull()
    expect(copied.isCompleted).toBe(false)
    expect(copied.id).not.toBe('t1')
    expect(comments.forTask(copied.id)).toHaveLength(0)
  })

  it('複製區段，任務的 sectionId 對應到新專案裡新建的區段', () => {
    const { tasks, collections, sections } = setup()
    const source = collections.addProject('工作')
    const section = sections.addSection(source.id, '待處理')
    tasks.items = [makeTask('看板卡片', false, { id: 't1', projectId: source.id, sectionId: section.id })]

    const copy = tasks.duplicateProject(source.id)
    const newSections = sections.forProject(copy!.id)
    expect(newSections.map((s) => s.name)).toEqual(['待處理'])

    const copiedTask = tasks.items.find((t) => t.projectId === copy?.id)
    expect(copiedTask?.sectionId).toBe(newSections[0]?.id)
  })

  it('子任務跟著複製，parentId 對應到新的父項 id；父項已完成時子項一併跳過', () => {
    const { tasks, collections } = setup()
    const source = collections.addProject('工作')
    tasks.items = [
      makeTask('父項', false, { id: 'parent', projectId: source.id }),
      makeTask('子項', false, { id: 'child', projectId: source.id, parentId: 'parent' }),
      makeTask('已完成的父項', true, { id: 'done-parent', projectId: source.id }),
      makeTask('孤兒子項', false, { id: 'orphan-child', projectId: source.id, parentId: 'done-parent' }),
    ]

    const copy = tasks.duplicateProject(source.id)
    const copiedTasks = tasks.items.filter((t) => t.projectId === copy?.id)

    expect(copiedTasks.map((t) => t.taskName).sort()).toEqual(['子項', '父項'])
    const newParent = copiedTasks.find((t) => t.taskName === '父項')
    const newChild = copiedTasks.find((t) => t.taskName === '子項')
    expect(newChild?.parentId).toBe(newParent?.id)
  })

  it('可以整批復原：新專案／區段／任務都消失', () => {
    const { tasks, collections, sections, history } = setup()
    const source = collections.addProject('工作')
    sections.addSection(source.id, '待處理')
    tasks.items = [makeTask('任務', false, { id: 't1', projectId: source.id })]

    const copy = tasks.duplicateProject(source.id)
    expect(collections.projects.map((p) => p.id)).toContain(copy?.id)

    history.undo()

    expect(collections.projects.map((p) => p.id)).not.toContain(copy?.id)
    expect(sections.items.filter((s) => s.projectId === copy?.id)).toHaveLength(0)
    expect(tasks.items.filter((t) => t.projectId === copy?.id)).toHaveLength(0)
    // 原本的專案跟任務都還在，不是被牽連的復原。
    expect(collections.projects.map((p) => p.id)).toContain(source.id)
    expect(tasks.items.map((t) => t.id)).toContain('t1')
  })
})
