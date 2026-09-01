import { test, expect, type Page } from '@playwright/test'

/**
 * 帳號與跨裝置同步。
 *
 * 完全不打真正的 Supabase——playwright.config.ts 給的是假的
 * VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY，只是要讓 isSyncConfigured
 * 為 true、「帳號與同步」入口顯示出來。這裡驗證的是登入流程本身的接線
 * （信箱 → 驗證碼 → 已登入）與畫面反應，不是 GoTrueClient／PostgREST
 * 的行為——那些不穩定、要錢、CI 也沒有密鑰可以打真正的請求。
 */

const FAKE_SESSION = {
  access_token: 'e2e-fake-access-token',
  refresh_token: 'e2e-fake-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'e2e-fake-user', email: 'e2e@example.com' },
}

async function mockSupabase(page: Page, options: { otpOk?: boolean; verifyOk?: boolean } = {}): Promise<void> {
  const { otpOk = true, verifyOk = true } = options

  await page.route('**/auth/v1/otp', async (route) => {
    if (otpOk) {
      await route.fulfill({ status: 200, json: {} })
    } else {
      await route.fulfill({ status: 429, json: { error: 'rate_limit_exceeded', msg: 'rate limit exceeded' } })
    }
  })

  await page.route('**/auth/v1/verify', async (route) => {
    if (verifyOk) {
      await route.fulfill({ status: 200, json: FAKE_SESSION })
    } else {
      await route.fulfill({ status: 403, json: { error: 'invalid_grant', msg: 'invalid token' } })
    }
  })

  // 登出會呼叫這支端點；沒攔到的話 fetch 會真的打到假網址失敗，
  // auth.signOut() 就會卡在那個 await 上，畫面永遠回不到未登入狀態。
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204 })
  })

  // 登入成功後 sync.start() 會拉這四張表；沒有東西可拉，回空陣列即可。
  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({ status: 200, json: [] })
  })
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
})

test.describe('帳號與同步', () => {
  test('信箱 → 驗證碼 → 已登入的完整流程', async ({ page }) => {
    await mockSupabase(page)

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await expect(dialog).toContainText('e2e@example.com')
    await expect(dialog.getByLabel('六碼驗證碼')).toBeVisible()

    await dialog.getByLabel('六碼驗證碼').fill('123456')
    await dialog.getByRole('button', { name: '驗證並登入' }).click()

    await expect(dialog).toContainText('已登入')
    await expect(dialog).toContainText('e2e@example.com')

    await dialog.getByRole('button', { name: '關閉' }).click()
    await expect(page.getByRole('button', { name: '帳號與同步' })).toBeVisible()
  })

  test('驗證碼錯誤時顯示錯誤，不會被誤判成功', async ({ page }) => {
    await mockSupabase(page, { verifyOk: false })

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await dialog.getByLabel('六碼驗證碼').fill('000000')
    await dialog.getByRole('button', { name: '驗證並登入' }).click()

    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog).not.toContainText('已登入')
  })

  test('Google 一鍵登入的完整往返：授權導向 → 帶碼回來 → 換成 session', async ({ page }) => {
    await mockSupabase(page)

    // 攔截 GoTrue 的 /authorize：真正的流程是瀏覽器被導去 Google 的同意畫面，
    // 這裡直接模擬「使用者按下允許」，302 導回我們自己的網址、帶著假的
    // PKCE code——驗證的重點正是這個往返：sync/authClient.ts 設定的
    // flowType: 'pkce' 讓這個 code 走查詢參數（?code=）而不是 hash 片段，
    // 才不會被這個工具的 hash 路由（#/all 這種網址）打架或洗掉。
    const origin = new URL(page.url()).origin
    await page.route('**/auth/v1/authorize*', async (route) => {
      await route.fulfill({ status: 302, headers: { location: `${origin}/?code=e2e-fake-pkce-code` } })
    })
    // PKCE 換 session 打的是這支端點，不是 /verify（那是 OTP 專用的）。
    await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
      await route.fulfill({ status: 200, json: FAKE_SESSION })
    })

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByRole('button', { name: '以 Google 繼續' }).click()

    // 點下去之後瀏覽器離開了原本的頁面（真的整頁導航，對話框自然消失），
    // 落地在帶著 code 的網址、觸發 main.ts 的 auth.restore()，
    // 換完 session 後網址上的 code 會被清掉，落回 hash 路由的 #/today。
    await expect(page.getByRole('button', { name: '帳號與同步' })).toBeVisible()
    expect(new URL(page.url()).search, 'code 應該已經被清掉').toBe('')
  })

  test('登出後回到未登入畫面，本地任務仍在', async ({ page }) => {
    await mockSupabase(page)
    await page.getByLabel('新增代辦事項').fill('登出前就有的任務')
    await page.getByRole('button', { name: '新增' }).click()

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await dialog.getByLabel('六碼驗證碼').fill('123456')
    await dialog.getByRole('button', { name: '驗證並登入' }).click()
    await expect(dialog).toContainText('已登入')

    await dialog.getByRole('button', { name: '登出' }).click()
    await expect(page.getByRole('button', { name: '登入以同步' })).toBeVisible()
    await expect(page.locator('main li p', { hasText: '登出前就有的任務' })).toBeVisible()
  })
})
