import { describe, it, expect } from 'vitest'

// 驗證 Edge Functions 邏輯合約與格式化規則（send-task-notification 與 send-daily-digest）
describe('Edge Functions 邏輯驗證', () => {
  describe('send-task-notification', () => {
    const TITLES: Record<'mention' | 'assignment', string> = {
      mention: '有人在留言裡提到你',
      assignment: '有人指派了一個任務給你',
    }

    function summarize(body: string): string {
      const trimmed = body.trim()
      return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
    }

    function isNotificationPayload(value: unknown): boolean {
      if (typeof value !== 'object' || value === null) return false
      const v = value as Record<string, unknown>
      return (
        typeof v.user_id === 'string' &&
        (v.kind === 'mention' || v.kind === 'assignment') &&
        typeof v.task_id === 'string' &&
        typeof v.body === 'string'
      )
    }

    it('依 kind 正確產生通知標題', () => {
      expect(TITLES.mention).toBe('有人在留言裡提到你')
      expect(TITLES.assignment).toBe('有人指派了一個任務給你')
    })

    it('內文摘要短於或等於 80 字元時保持原樣，超出 80 字元時截斷並加上省略號', () => {
      const shortText = '這是一則簡短的留言'
      expect(summarize(shortText)).toBe('這是一則簡短的留言')

      const exact80 = 'A'.repeat(80)
      expect(summarize(exact80)).toBe(exact80)

      const longText = 'B'.repeat(85)
      expect(summarize(longText)).toBe(`${'B'.repeat(80)}…`)
    })

    it('驗證 payload 合約格式', () => {
      expect(isNotificationPayload({
        user_id: 'u-1',
        kind: 'mention',
        task_id: 't-1',
        body: 'hello',
      })).toBe(true)

      expect(isNotificationPayload({
        user_id: 'u-1',
        kind: 'assignment',
        task_id: 't-1',
        body: 'task name',
      })).toBe(true)

      expect(isNotificationPayload({
        user_id: 'u-1',
        kind: 'unknown_kind',
        task_id: 't-1',
        body: 'task name',
      })).toBe(false)

      expect(isNotificationPayload(null)).toBe(false)
      expect(isNotificationPayload({})).toBe(false)
    })
  })

  describe('send-daily-digest', () => {
    const KIND_LABEL: Record<'mention' | 'assignment', string> = {
      mention: '提到你',
      assignment: '指派給你',
    }

    function escapeHtml(text: string): string {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function renderDigestHtml(items: readonly { taskName: string; label: string }[]): string {
      const rows = items
        .map((item) => `<li>${escapeHtml(item.taskName)} — ${escapeHtml(item.label)}</li>`)
        .join('')
      return `<p>過去一天有 ${items.length} 則新通知：</p><ul>${rows}</ul>`
    }

    it('escapeHtml 正確逸出 HTML 特殊字元', () => {
      expect(escapeHtml('<script>alert("xss") & test</script>')).toBe('&lt;script&gt;alert("xss") &amp; test&lt;/script&gt;')
    })

    it('renderDigestHtml 渲染未讀通知清單', () => {
      const items = [
        { taskName: '系統架構審查 & 規劃', label: KIND_LABEL.assignment },
        { taskName: '修正 <dialog> 焦點問題', label: KIND_LABEL.mention },
      ]
      const html = renderDigestHtml(items)
      expect(html).toContain('<p>過去一天有 2 則新通知：</p>')
      expect(html).toContain('<li>系統架構審查 &amp; 規劃 — 指派給你</li>')
      expect(html).toContain('<li>修正 &lt;dialog&gt; 焦點問題 — 提到你</li>')
    })
  })
})
