import { describe, it, expect } from 'vitest'
import BoardView from '@/components/BoardView.vue'
import { useTasksStore } from '@/stores/tasks'
import { useSectionsStore } from '@/stores/sections'
import { useUiStore } from '@/stores/ui'
import { freshPinia, mountWith, makeTask } from '@/test/helpers'

function setup() {
  const pinia = freshPinia()
  const tasks = useTasksStore()
  const sections = useSectionsStore()
  const ui = useUiStore()
  return { pinia, tasks, sections, ui }
}

describe('BoardView.vue — 欄位', () => {
  it('永遠有「未分類」欄，之後依序是這個專案的區段', () => {
    const { pinia, sections } = setup()
    sections.addSection('p1', '待處理')
    sections.addSection('p1', '進行中')
    sections.addSection('p2', '別的專案的區段')

    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })
    const headings = w.findAll('h2').map((h) => h.text().replace(/\s*\d+$/, ''))
    expect(headings).toEqual(['未分類', '待處理', '進行中'])
  })

  it('只顯示這個專案、未完成、頂層的任務', () => {
    const { pinia, tasks } = setup()
    tasks.items = [
      makeTask('顯示：本專案未完成頂層', false, { id: 'a', projectId: 'p1' }),
      makeTask('不顯示：別的專案', false, { id: 'b', projectId: 'p2' }),
      makeTask('不顯示：已完成', true, { id: 'c', projectId: 'p1' }),
      makeTask('不顯示：子任務', false, { id: 'd', projectId: 'p1', parentId: 'a' }),
    ]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    expect(w.text()).toContain('顯示：本專案未完成頂層')
    expect(w.text()).not.toContain('不顯示：別的專案')
    expect(w.text()).not.toContain('不顯示：已完成')
    expect(w.text()).not.toContain('不顯示：子任務')
  })
})

describe('BoardView.vue — 卡片互動', () => {
  it('勾選核取方塊呼叫 tasks.toggle', async () => {
    const { pinia, tasks } = setup()
    tasks.items = [makeTask('任務', false, { id: 'a', projectId: 'p1' })]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })
    await w.find('input[type="checkbox"]').setValue(true)
    expect(tasks.items[0]?.isCompleted).toBe(true)
  })

  it('點擊任務名稱呼叫 ui.openDetail', async () => {
    const { pinia, tasks, ui } = setup()
    tasks.items = [makeTask('任務', false, { id: 'a', projectId: 'p1' })]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })
    const nameButton = w.findAll('button').find((b) => b.text() === '任務')
    await nameButton?.trigger('click')
    expect(ui.detailTaskId).toBe('a')
  })

  it('上移／下移按鈕在欄內正確移動', async () => {
    const { pinia, tasks } = setup()
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', order: 1 }),
      makeTask('B', false, { id: 'b', projectId: 'p1', order: 2 }),
    ]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })
    const downButtons = w.findAll('button[aria-label$="在欄內下移"]')
    await downButtons[0]?.trigger('click')

    const order = [...tasks.items].sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((t) => t.id)
    expect(order).toEqual(['b', 'a'])
  })

  it('「移到...」選單呼叫 moveToSection 搬到另一個區段', async () => {
    const { pinia, tasks, sections } = setup()
    const section = sections.addSection('p1', '進行中')
    tasks.items = [makeTask('任務', false, { id: 'a', projectId: 'p1', sectionId: null })]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const select = w.find('select[id^="move-to-"]')
    await select.setValue(section.id)

    expect(tasks.items[0]?.sectionId).toBe(section.id)
  })
})

describe('BoardView.vue — 新增任務／新增區段', () => {
  it('在某一欄的表單新增任務，帶上該欄的 sectionId', async () => {
    const { pinia, tasks, sections } = setup()
    const section = sections.addSection('p1', '進行中')
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const forms = w.findAll('form')
    // 第一個表單屬於「未分類」欄，第二個屬於「進行中」欄，最後一個是新增區段。
    const sectionForm = forms[1]
    await sectionForm?.find('input').setValue('看板新任務')
    await sectionForm?.trigger('submit')

    const created = tasks.items.find((t) => t.taskName === '看板新任務')
    expect(created?.sectionId).toBe(section.id)
    expect(created?.projectId).toBe('p1')
  })

  it('新增區段表單建立新欄，清空輸入框', async () => {
    const { pinia, sections } = setup()
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const forms = w.findAll('form')
    const addSectionForm = forms[forms.length - 1]
    const input = addSectionForm?.find('input')
    await input?.setValue('新看板欄')
    await addSectionForm?.trigger('submit')

    expect(sections.forProject('p1').map((s) => s.name)).toEqual(['新看板欄'])
    expect((input?.element as HTMLInputElement).value).toBe('')
  })
})

describe('BoardView.vue — 區段管理', () => {
  it('重新命名：輸入後按 Enter 生效', async () => {
    const { pinia, sections } = setup()
    const section = sections.addSection('p1', '待處理')
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    await w.find(`button[aria-label="重新命名「${section.name}」"]`).trigger('click')
    const input = w.find(`#rename-${section.id}`)
    await input.setValue('進行中')
    await input.trigger('keydown.enter')

    expect(sections.items.find((s) => s.id === section.id)?.name).toBe('進行中')
  })

  it('刪除區段按鈕呼叫 tasks.removeSection', async () => {
    const { pinia, sections } = setup()
    const section = sections.addSection('p1', '待處理')
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    await w.find(`button[aria-label="刪除區段「${section.name}」"]`).trigger('click')

    expect(sections.items).toHaveLength(0)
  })

  it('「未分類」欄沒有重新命名／刪除／欄位移動按鈕', () => {
    const { pinia } = setup()
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })
    expect(w.find('button[aria-label*="未分類"]').exists()).toBe(false)
  })

  it('欄位左移／右移按鈕在邊界時停用', () => {
    const { pinia, sections } = setup()
    sections.addSection('p1', 'A')
    sections.addSection('p1', 'B')
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const leftButtons = w.findAll('button[aria-label="欄位左移"]')
    const rightButtons = w.findAll('button[aria-label="欄位右移"]')
    // 第一個真的區段（index 1，因為未分類佔 index 0）左移應該停用。
    expect(leftButtons[0]?.attributes('disabled')).toBeDefined()
    expect(rightButtons[rightButtons.length - 1]?.attributes('disabled')).toBeDefined()
  })
})

describe('BoardView.vue — 拖曳（滑鼠加強路徑）', () => {
  it('拖到另一欄的空白處，搬到該欄最後面', async () => {
    const { pinia, tasks, sections } = setup()
    const section = sections.addSection('p1', '進行中')
    tasks.items = [makeTask('任務', false, { id: 'a', projectId: 'p1', sectionId: null })]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const card = w.find('li[draggable="true"]')
    await card.trigger('dragstart')
    const columns = w.findAll('section')
    await columns[1]?.trigger('drop')

    expect(tasks.items[0]?.sectionId).toBe(section.id)
  })

  it('拖到某張卡片上，插在該卡片之前', async () => {
    const { pinia, tasks, sections } = setup()
    const section = sections.addSection('p1', '進行中')
    tasks.items = [
      makeTask('A', false, { id: 'a', projectId: 'p1', sectionId: section.id, order: 1 }),
      makeTask('B', false, { id: 'b', projectId: 'p1', sectionId: null, order: 2 }),
    ]
    const w = mountWith(BoardView, pinia, { props: { projectId: 'p1' } })

    const cards = w.findAll('li[draggable="true"]')
    const cardB = cards[0]
    const cardA = cards[1]

    await cardB?.trigger('dragstart')
    await cardA?.trigger('drop')

    const movedB = tasks.items.find((t) => t.id === 'b')
    expect(movedB?.sectionId).toBe(section.id)
    const sectionTasks = tasks.items.filter((t) => t.sectionId === section.id).sort((x, y) => (x.rank < y.rank ? -1 : 1))
    expect(sectionTasks.map((t) => t.id)).toEqual(['b', 'a'])
  })
})
