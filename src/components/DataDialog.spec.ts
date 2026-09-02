import { describe, it, expect } from 'vitest'
import DataDialog from '@/components/DataDialog.vue'
import { freshPinia, mountWith } from '@/test/helpers'

/**
 * isPushConfigured 為 true 時的行為在 DataDialog.push.spec.ts——兩支分開
 * 是因為 vi.mock('@/sync/config') 即使寫在 describe 區塊裡面，實際上還是
 * 整個檔案生效（Vitest 自己在執行期會警告這件事），跟
 * collections.outboxSync.spec.ts 之所以跟 collections.spec.ts 分開是同一個坑。
 */
describe('DataDialog.vue — 推播通知區塊', () => {
  it('isPushConfigured 為 false（沒設定 VITE_VAPID_PUBLIC_KEY）時整段不顯示', () => {
    const pinia = freshPinia()
    const w = mountWith(DataDialog, pinia, { props: { open: true } })
    expect(w.text()).not.toContain('推播通知')
  })
})
