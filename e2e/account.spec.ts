import { test, expect, type Page } from '@playwright/test'

/**
 * 帳號與跨裝置同步。
 *
 * 完全不打真正的 Supabase——playwright.config.ts 給的是假的
 * VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY，只是要讓 isSyncConfigured
 * 為 true、「帳號與同步」入口顯示出來。這裡驗證的是登入流程本身的接線
 * （信箱 → 連結 → 已登入）與畫面反應，不是 GoTrueClient／PostgREST
 * 的行為——那些不穩定、要錢、CI 也沒有密鑰可以打真正的請求。
 *
 * 「等待」畫面不再是六碼驗證碼輸入框：Supabase 免費方案的內建信件服務
 * 鎖死範本編輯（要接自訂 SMTP 才能改成 {{ .Token }}），寄出的一律是連結。
 * authClient.ts 統一設定 flowType: 'pkce'，所以不管是點信件裡的連結還是
 * OAuth 授權完成，最後都是同一條路：瀏覽器帶著 ?code= 落回我們的網址，
 * 換成 session。e2e 裡沒有真正的信箱可以點，用直接把 code 換成 session
 * 的網路請求模擬「使用者點了連結」，驗證的正是這個共用的換票邏輯本身。
 */

const FAKE_SESSION = {
  access_token: 'e2e-fake-access-token',
  refresh_token: 'e2e-fake-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'e2e-fake-user', email: 'e2e@example.com' },
}

async function mockSupabase(page: Page, options: { otpOk?: boolean } = {}): Promise<void> {
  const { otpOk = true } = options

  await page.route('**/auth/v1/otp', async (route) => {
    if (otpOk) {
      await route.fulfill({ status: 200, json: {} })
    } else {
      await route.fulfill({ status: 429, json: { error: 'rate_limit_exceeded', msg: 'rate limit exceeded' } })
    }
  })

  // PKCE 換 session 打的是這支端點，不管進來的 code 是信箱連結還是 OAuth 給的。
  await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
    await route.fulfill({ status: 200, json: FAKE_SESSION })
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

/**
 * 模擬「使用者點了信箱裡的連結」：直接導去帶著 PKCE code 的網址，跟真正的連結
 * 落地位置一樣。用相對路徑（吃 playwright.config.ts 的 baseURL）而不是從
 * page.url() 推 origin——一個全新開的分頁（尚未 goto 過任何東西）的
 * page.url() 是 about:blank，沒有 origin 可以推。
 */
async function clickMagicLink(page: Page): Promise<void> {
  await page.goto('/?code=e2e-fake-pkce-code')
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
})

test.describe('帳號與同步', () => {
  test('信箱 → 連結 → 已登入的完整流程', async ({ page }) => {
    await mockSupabase(page)

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await expect(dialog).toContainText('e2e@example.com')
    await expect(dialog).toContainText('去信箱點裡面的連結')
    await expect(dialog.getByLabel('六碼驗證碼')).toHaveCount(0)

    // 點連結是真正的整頁導航（同分頁點開的情境）——原本開著的 dialog 自然消失，
    // 落地在帶 code 的網址，main.ts 的 auth.restore() 接手換票。
    await clickMagicLink(page)

    await expect(page.getByRole('button', { name: '帳號與同步' })).toBeVisible()
    expect(new URL(page.url()).search, 'code 應該已經被清掉').toBe('')

    await page.getByRole('button', { name: '帳號與同步' }).click()
    await expect(dialog).toContainText('已登入')
    await expect(dialog).toContainText('e2e@example.com')
  })

  test('寄送失敗時顯示錯誤，不會進入等待畫面', async ({ page }) => {
    await mockSupabase(page, { otpOk: false })

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()

    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog).not.toContainText('去信箱點裡面的連結')
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

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByRole('button', { name: '以 Google 繼續' }).click()

    // 點下去之後瀏覽器離開了原本的頁面（真的整頁導航，對話框自然消失），
    // 落地在帶著 code 的網址、觸發 main.ts 的 auth.restore()，
    // 換完 session 後網址上的 code 會被清掉，落回 hash 路由的 #/today。
    await expect(page.getByRole('button', { name: '帳號與同步' })).toBeVisible()
    expect(new URL(page.url()).search, 'code 應該已經被清掉').toBe('')
  })

  test('登入在另一個分頁完成時，原本停在等待畫面的分頁會自動反映成已登入', async ({ context, page }) => {
    // 這條釘住實際修過的臭蟲：使用者在分頁 A 送出信箱、停在「去信箱點連結」畫面，
    // 接著在分頁 B（或手機）點開信件裡的連結完成登入——分頁 A 不能永遠卡住，
    // 得靠 BroadcastChannel（stores/auth.ts 的 ensureAuthClient）被動反映成已登入。
    await mockSupabase(page)

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await expect(dialog).toContainText('去信箱點裡面的連結')

    // 分頁 B：同一個 browser context 才會共用 BroadcastChannel（同源、同一個瀏覽器設定檔）。
    const pageB = await context.newPage()
    await mockSupabase(pageB)
    await clickMagicLink(pageB)
    await expect(pageB.getByRole('button', { name: '帳號與同步' })).toBeVisible()

    // 分頁 A 完全沒有被操作，應該自己從廣播收到登入完成的消息。
    await expect(dialog).toContainText('已登入', { timeout: 10_000 })
    await expect(dialog).toContainText('e2e@example.com')

    await pageB.close()
  })

  test('登出後回到未登入畫面，本地任務仍在', async ({ page }) => {
    await mockSupabase(page)
    await page.getByLabel('新增代辦事項').fill('登出前就有的任務')
    await page.getByRole('button', { name: '新增' }).click()

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByLabel('電子郵件').fill('e2e@example.com')
    await dialog.getByRole('button', { name: '寄送驗證碼' }).click()
    await expect(dialog).toContainText('去信箱點裡面的連結')

    await clickMagicLink(page)
    // getByRole('button').click() 有內建的自動重試，會等到換票／套用 session
    // 這段非同步流程真的跑完才點得到——不能在這裡插一次額外的 page.goto()，
    // 那是一次性的導航，不會等；太早導航等於在換票完成前就把它打斷。
    await page.getByRole('button', { name: '帳號與同步' }).click()
    await expect(dialog).toContainText('已登入')

    await dialog.getByRole('button', { name: '登出' }).click()
    await expect(page.getByRole('button', { name: '登入以同步' })).toBeVisible()

    // 點連結落地後一律回到 hash 路由的 #/today（AGENTS.md：/ 重新導向 /today），
    // 跟原本開著的 #/all 不是同一個檢視——沒有到期日的任務在「今天」看不到，
    // 得切回「全部」才看得到剛剛建立的那筆。這裡登入／登出都已經穩定結束，
    // 再導航不會打斷任何還在進行中的非同步流程。
    await page.goto('/#/all')
    await expect(page.locator('main li p', { hasText: '登出前就有的任務' })).toBeVisible()
  })
})
