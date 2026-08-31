import { describe, it, expect, beforeEach } from 'vitest'
import type { Pinia } from 'pinia'
import type { Router } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { freshPinia, mountWith, makeTask, testRouter, type Wrapper } from '@/test/helpers'
import { today, addDays } from '@/domain/dates'

/**
 * 側邊導覽取代了原本的三個分頁。
 *
 * 分頁那個形狀只表達得了「同一份清單的三種篩選」；這裡要驗證的是新的骨架：
 * 每個入口都是真正的連結（可鍵盤操作、可分享），目前位置以 aria-current 標示
 * 而不只靠底色（稽核 P5/P6），而徽章的數字與清單走同一條 domain 路徑。
 */
describe('AppSidebar.vue', () => {
  let pinia: Pinia
  let tasks: ReturnType<typeof useTasksStore>
  let collections: ReturnType<typeof useCollectionsStore>
  let router: Router

  beforeEach(() => {
    pinia = freshPinia()
    tasks = useTasksStore()
    collections = useCollectionsStore()
    tasks.isLoading = false
    router = testRouter()
  })

  const mountSidebar = () => mountWith(AppSidebar, pinia, { router })
  const links = (w: Wrapper) => w.findAll('a')
  const hrefs = (w: Wrapper) => links(w).map((a) => a.attributes('href'))

  it('固定檢視都是真正的連結，鍵盤可聚焦、可分享', () => {
    const w = mountSidebar()
    for (const a of links(w)) {
      expect(a.element.tagName).toBe('A')
      expect(a.attributes('href')).toBeTruthy()
    }
    expect(hrefs(w)).toEqual([
      '/today',
      '/upcoming',
      '/inbox',
      '/all',
      '/active',
      '/completed',
      '/stats',
    ])
  })

  it('專案與標籤各自有可點的入口——先前它們只是顯示用的徽章', async () => {
    const project = collections.addProject('工作')
    const tag = collections.addTag('緊急')
    const w = mountSidebar()
    await w.vm.$nextTick()

    expect(hrefs(w)).toContain(`/project/${project.id}`)
    expect(hrefs(w)).toContain(`/label/${tag.id}`)
    expect(w.text()).toContain('工作')
    expect(w.text()).toContain('#緊急')
  })

  it('專案顏色真的畫出來，不再只是存著沒用', async () => {
    collections.addProject('設計', '#ea580c')
    const w = mountSidebar()
    await w.vm.$nextTick()

    const dot = w.find('a[href^="/project/"] span[aria-hidden="true"]')
    expect(dot.attributes('style')).toContain('background-color: #ea580c')
  })

  it('目前位置以 aria-current 標示，不只靠顏色', async () => {
    const w = mountSidebar()
    await router.push('/upcoming')
    await w.vm.$nextTick()

    const current = links(w).filter((a) => a.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]?.attributes('href')).toBe('/upcoming')
  })

  it('徽章數字與 domain 的檢視計算一致', async () => {
    tasks.items = [
      makeTask('今天到期', false, { dueDate: today() }),
      makeTask('三天後', false, { dueDate: addDays(today(), 3) }),
      makeTask('沒日期', false),
    ]
    const w = mountSidebar()
    await w.vm.$nextTick()

    const textOf = (href: string) => links(w).find((a) => a.attributes('href') === href)?.text()
    expect(textOf('/today')).toContain('1')
    expect(textOf('/upcoming')).toContain('2')
    // 收件匣＝未分類且未完成，三筆都算
    expect(textOf('/inbox')).toContain('3')
  })

  it('有逾期時「今天」改為顯示逾期警示，而不是只給一個中性的數字', async () => {
    tasks.items = [makeTask('逾期的事', false, { dueDate: addDays(today(), -2) })]
    const w = mountSidebar()
    await w.vm.$nextTick()

    expect(links(w).find((a) => a.attributes('href') === '/today')?.text()).toContain('逾期 1')
  })

  it('數量為零的入口不顯示徽章，避免一整排 0 洗掉真正有東西的項目', () => {
    const w = mountSidebar()
    expect(w.text()).not.toContain('0')
  })

  it('點連結時發出 navigate，讓抽屜模式可以順手關掉自己', async () => {
    const w = mountSidebar()
    await links(w)[0]?.trigger('click')
    expect(w.emitted('navigate')).toBeTruthy()
  })

  it('管理按鈕發出 manage 事件', async () => {
    const w = mountSidebar()
    await w.find('button[aria-label="管理專案與標籤"]').trigger('click')
    expect(w.emitted('manage')).toBeTruthy()
  })

  it('資料與提醒是按鈕而不是連結——它開的是對話框，不是一個可分享的位置', async () => {
    const w = mountSidebar()
    const dataButton = w.findAll('button').filter((b) => b.text() === '資料與提醒')
    expect(dataButton).toHaveLength(1)
    await dataButton[0]?.trigger('click')
    expect(w.emitted('data')).toBeTruthy()
  })
})
