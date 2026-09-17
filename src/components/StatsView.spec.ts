import { describe, it, expect, beforeEach } from 'vitest'
import StatsView from '@/components/StatsView.vue'
import { useTasksStore } from '@/stores/tasks'
import { freshPinia, mountWith } from '@/test/helpers'
import { today, addDays } from '@/domain/dates'

describe('StatsView.vue — 統計與回顧頁面', () => {
  beforeEach(() => {
    freshPinia()
    useTasksStore().isLoading = false
  })

  it('無完成紀錄時顯示空狀態提示', () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    tasks.add('未完成任務 1')

    const w = mountWith(StatsView, pinia)

    expect(w.text()).toContain('還沒有完成紀錄。完成第一件事之後，這裡會開始有東西。')
    expect(w.text()).toContain('還沒有已完成的代辦事項。')
    expect(w.text()).toContain('尚未完成')
    expect(w.text()).toContain('1')
  })

  it('有完成紀錄時正確呈現統計卡片、最近 14 天條狀圖與最近完成清單', () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const now = new Date()
    const todayISO = today()

    // 建立 1 筆未完成任務
    tasks.add('尚未完成的事情')

    // 建立今天完成的任務
    const t1 = tasks.add('今天做好的事')
    tasks.update(t1.id, {
      isCompleted: true,
      completedAt: now.getTime(),
      dueDate: todayISO,
    })

    // 建立昨天完成的任務
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const yesterdayISO = addDays(todayISO, -1)
    const t2 = tasks.add('昨天做好的事')
    tasks.update(t2.id, {
      isCompleted: true,
      completedAt: yesterday.getTime(),
      dueDate: yesterdayISO,
    })

    const w = mountWith(StatsView, pinia)

    // 四張指標卡片
    expect(w.text()).toContain('今天完成')
    expect(w.text()).toContain('最近七天')
    expect(w.text()).toContain('連續天數')
    expect(w.text()).toContain('尚未完成')

    // 最近 14 天長條圖應存在，不再是空狀態
    expect(w.text()).not.toContain('還沒有完成紀錄')
    const chart = w.find('ol')
    expect(chart.exists()).toBe(true)

    // 最近完成任務清單
    expect(w.text()).toContain('今天做好的事')
    expect(w.text()).toContain('昨天做好的事')
  })

  it('最近完成清單最多僅顯示 10 筆並按完成時間降冪排序', () => {
    const pinia = freshPinia()
    const tasks = useTasksStore()
    const baseTime = Date.now()

    // 建立 12 筆完成的任務（項目 A ~ L）
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    for (let i = 0; i < names.length; i++) {
      const t = tasks.add(`項目-${names[i]}`)
      tasks.update(t.id, {
        isCompleted: true,
        completedAt: baseTime + i * 1000,
      })
    }

    const w = mountWith(StatsView, pinia)
    const listItems = w.findAll('section:last-of-type li')

    expect(listItems.length).toBe(10)
    // 第一筆應該是最新完成的（項目-L）
    expect(listItems[0]?.text()).toContain('項目-L')
    // 項目-A 與 項目-B 超過 10 筆限制，不應出現在最近完成
    expect(w.find('section:last-of-type').text()).not.toContain('項目-A')
    expect(w.find('section:last-of-type').text()).not.toContain('項目-B')
  })
})
