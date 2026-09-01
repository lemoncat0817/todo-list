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
 *
 * AccountDialog.vue 的 EMAIL_LOGIN_ENABLED 目前是 false（同一個免費信件
 * 額度太低的問題，OAuth 不經過這個服務），信箱表單專屬的測試因此先
 * test.skip，不是刪除；PKCE 換票這條路徑是信箱連結跟 OAuth 共用的，所以
 * 大多數測試改用 clickMagicLink() 直接模擬「登入在別處完成」，不特別
 * 區分觸發方式。
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
 *
 * 注意：PKCE 的 code 要換成 session，這個分頁本身必須先有一組本地存好的
 * code_verifier（signInWithOtp／signInWithOAuth 呼叫當下就會生成並存進
 * localStorage，跟 code_challenge 配對）——直接對一個「從沒呼叫過這兩個
 * 函式」的分頁導這個網址，GoTrueClient 找不到對應的 code_verifier，換票
 * 一定失敗，不會有任何網路請求（實測發現：既沒有錯誤、也沒有 auth/v1
 * 的請求，是靜靜地放棄，唯一線索是網址上的 code 一直沒被清掉）。所以
 * 這個 helper 只適合「同一個分頁自己先觸發過登入」的情境，不能拿來
 * 憑空模擬另一個裝置的信箱連結——那種情境要用真的按鈕點過的 page（例如
 * 下面測試改用「以 Google 繼續」在目標分頁上先跑一次真正的往返）。
 */
async function clickMagicLink(page: Page): Promise<void> {
  await page.goto('/?code=e2e-fake-pkce-code')
}

/** 攔截 GoTrue 的 /authorize，模擬「使用者在供應商頁面按下允許」直接 302 帶碼回來。 */
async function mockOAuthRedirect(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin
  await page.route('**/auth/v1/authorize*', async (route) => {
    await route.fulfill({ status: 302, headers: { location: `${origin}/?code=e2e-fake-pkce-code` } })
  })
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
})

test.describe('帳號與同步', () => {
  // AccountDialog.vue 的 EMAIL_LOGIN_ENABLED 目前是 false（Supabase 免費方案
  // 「沒接自訂 SMTP」的內建測試信件額度太低，反覆撞到「請求太頻繁」，先只留
  // 不經過信件服務的 OAuth）——信箱表單不在畫面上，這兩條測試先 skip，
  // 不是刪除，底層 requestMagicLink／'verifying' 畫面邏輯沒有變。
  test.skip('信箱 → 連結 → 已登入的完整流程', async ({ page }) => {
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

  test.skip('寄送失敗時顯示錯誤，不會進入等待畫面', async ({ page }) => {
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

  test('已登入時，在另一個分頁登出，這個分頁也會自動反映成未登入', async ({ context, page }) => {
    // 這條釘住實際修過的臭蟲的對稱情境：分頁 A 已登入、什麼都沒做，
    // 分頁 B 登出——分頁 A 不能永遠顯示舊的已登入狀態，得靠
    // BroadcastChannel（stores/auth.ts 的 ensureAuthClient）被動反映成
    // 未登入。分頁 A「什麼都沒做也在聽」是因為它本來就已經登入過，開機
    // 時 restore() 看到本地存的 session 就會呼叫 ensureAuthClient() 訂閱，
    // 跟登入當下訂閱是同一條路徑，不是另外開的後門。
    //
    // 用「登出」而不是「登入」當作跨分頁情境，是因為 OAuth 一鍵登入是
    // 整頁導航——分頁一旦點下按鈕就會離開，沒有「留在原地被動等待」這種
    // 中間狀態可以測；而信箱連結那種留得住的等待畫面目前隱藏
    // （EMAIL_LOGIN_ENABLED = false）。已登入的分頁則相反：它天生就是
    // 「留在原地、訂閱著、什麼都不用做」的狀態，正好拿來測廣播。
    await mockSupabase(page)
    await mockOAuthRedirect(page)

    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByRole('button', { name: '以 Google 繼續' }).click()
    await page.getByRole('button', { name: '帳號與同步' }).click()
    await expect(dialog).toContainText('已登入')
    await dialog.getByRole('button', { name: '關閉' }).click()

    // 分頁 B：同一個 browser context 才會共用 BroadcastChannel（同源、同一個瀏覽器設定檔）
    // ——登入狀態存在這個 origin 共用的 localStorage 裡，分頁 B 一開就已經是已登入。
    const pageB = await context.newPage()
    await mockSupabase(pageB)
    await pageB.goto('/#/all')
    await expect(pageB.getByRole('button', { name: '帳號與同步' })).toBeVisible()
    await pageB.getByRole('button', { name: '帳號與同步' }).click()
    await pageB.getByRole('dialog').filter({ hasText: '帳號與同步' }).getByRole('button', { name: '登出' }).click()

    // 分頁 A 完全沒有被操作，應該自己從廣播收到登出的消息。
    await expect(page.getByRole('button', { name: '登入以同步' })).toBeVisible({ timeout: 10_000 })

    await pageB.close()
  })

  test('登出後回到未登入畫面，本地任務仍在', async ({ page }) => {
    await mockSupabase(page)
    await mockOAuthRedirect(page)
    await page.getByLabel('新增代辦事項').fill('登出前就有的任務')
    await page.getByRole('button', { name: '新增' }).click()

    // 信箱表單目前隱藏（EMAIL_LOGIN_ENABLED = false），登入走 OAuth——
    // 點下去是真正的整頁導航，原本開著的 dialog 自然消失，落地在帶 code
    // 的網址時 main.ts 的 auth.restore() 接手換票，換完會清掉網址上的
    // code、落回 hash 路由的 #/today。
    await page.getByRole('button', { name: '登入以同步' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
    await dialog.getByRole('button', { name: '以 Google 繼續' }).click()

    // getByRole('button').click() 有內建的自動重試，會等到換票／套用 session
    // 這段非同步流程真的跑完才點得到。
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
