import { describe, it, expect } from 'vitest'
import TaskDetailForm from '@/components/TaskDetailForm.vue'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

/**
 * 只驗證換專案時 sectionId 的處理——表單本身沒有「改區段」的欄位
 * （那是看板拖曳的事，見 stores/tasks.ts 的 moveToSection()），這裡要
 * 確認的是換專案時舊區段的指派不會殘留成一個伺服器會拒絕的無效值。
 */
describe('TaskDetailForm.vue — 換專案時的區段處理', () => {
  it('沒有換專案時，原本的 sectionId 原封不動', async () => {
    const pinia = freshPinia()
    const collections = useCollectionsStore()
    const project = collections.addProject('工作')
    const tasks = useTasksStore()
    const task = makeTask('任務', false, { projectId: project.id, sectionId: 'sec-1' })
    tasks.items = [task]

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    await w.find('form').trigger('submit')

    expect(tasks.items[0]?.sectionId).toBe('sec-1')
  })

  it('換到別的專案時，sectionId 被清成 null——舊區段屬於舊專案', async () => {
    const pinia = freshPinia()
    const collections = useCollectionsStore()
    const projectA = collections.addProject('工作')
    const projectB = collections.addProject('個人')
    const tasks = useTasksStore()
    const task = makeTask('任務', false, { projectId: projectA.id, sectionId: 'sec-1' })
    tasks.items = [task]

    const w = mountWith(TaskDetailForm, pinia, { props: { task } })
    // select 的順序是優先度 → 到期日/時間 → 專案，第二個（index 1）是專案。
    await w.findAll('select')[1]?.setValue(projectB.id)
    await w.find('form').trigger('submit')

    expect(tasks.items[0]?.projectId).toBe(projectB.id)
    expect(tasks.items[0]?.sectionId).toBeNull()
  })
})
