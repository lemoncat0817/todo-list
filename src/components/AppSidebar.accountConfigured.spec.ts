import { describe, it, expect, vi } from 'vitest'
import AppSidebar from '@/components/AppSidebar.vue'
import { freshPinia, mountWith, testRouter } from '@/test/helpers'

/**
 * 「帳號與同步」入口在已設定 Supabase 時的行為，拆成獨立檔案是因為
 * vi.mock('@/sync/config', ...) 在檔案層級生效——跟 AppSidebar.spec.ts
 * 其餘假設「沒有接 Supabase」的測試混在一起會互相干擾。
 * 未設定時的行為（入口整個不顯示）在 AppSidebar.spec.ts 裡驗證，
 * 那裡完全不需要 mock，本來就是測試環境的預設狀態。
 */
vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))

describe('AppSidebar.vue — 帳號與同步入口（已設定 Supabase）', () => {
  it('顯示入口，點擊後發出 account 事件', async () => {
    const pinia = freshPinia()
    const w = mountWith(AppSidebar, pinia, { router: testRouter() })
    await w.vm.$nextTick()

    const entry = w.findAll('button').find((b) => b.text().includes('同步'))
    expect(entry, '設定過 Supabase 時應該看得到入口').toBeDefined()

    await entry?.trigger('click')
    expect(w.emitted('account')).toBeTruthy()
  })
})
