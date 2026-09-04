import { test, expect, type Page } from '@playwright/test'

const FAKE_USER = { id: 'user-alice', email: 'alice@example.com' }
const FAKE_SESSION = {
  access_token: 'e2e-fake-access-token',
  refresh_token: 'e2e-fake-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: FAKE_USER,
}

interface MockNotification {
  id: string
  user_id: string
  actor_id: string | null
  kind: 'mention' | 'assignment'
  task_id: string
  detail: { body?: string }
  read_at: number | null
  created_at: number
  updated_at: number
}

async function setupAuthenticatedPage(
  page: Page,
  options: {
    notifications?: MockNotification[]
    prefs?: { notify_on_mention: boolean; notify_on_assignment: boolean; daily_digest_enabled: boolean }
    tasks?: { id: string; task_name: string }[]
  } = {},
): Promise<{
  getNotifications: () => MockNotification[]
  getPrefs: () => { notify_on_mention: boolean; notify_on_assignment: boolean; daily_digest_enabled: boolean }
  getPatchCalls: () => { url: string; body: unknown }[]
  getPrefUpsertCalls: () => unknown[]
}> {
  const notificationsState: MockNotification[] = options.notifications
    ? [...options.notifications]
    : [
        {
          id: 'n-1',
          user_id: FAKE_USER.id,
          actor_id: 'user-bob',
          kind: 'assignment',
          task_id: 't-1',
          detail: { body: '重要專案規劃' },
          read_at: null,
          created_at: Date.now() - 1000 * 60 * 10,
          updated_at: Date.now() - 1000 * 60 * 10,
        },
        {
          id: 'n-2',
          user_id: FAKE_USER.id,
          actor_id: 'user-charlie',
          kind: 'mention',
          task_id: 't-2',
          detail: { body: '請看這則留言' },
          read_at: null,
          created_at: Date.now() - 1000 * 60 * 5,
          updated_at: Date.now() - 1000 * 60 * 5,
        },
      ]

  const prefsState = options.prefs ?? {
    notify_on_mention: true,
    notify_on_assignment: true,
    daily_digest_enabled: false,
  }

  const patchCalls: { url: string; body: unknown }[] = []
  const prefUpsertCalls: unknown[] = []

  // Auth mock
  await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
    await route.fulfill({ status: 200, json: FAKE_SESSION })
  })
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204 })
  })

  // Fallback for other rest tables (projects, tags, etc.) - registered first so specific routes take precedence (LIFO)
  await page.route('**/rest/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/tasks')) {
      const taskList = options.tasks ?? [
        { id: 't-1', task_name: '重要專案規劃', workspace_id: 'ws-1', rank: '0|hzzzzz:', is_completed: false, priority: 0, notes: '', created_at: 1, updated_at: 1, user_id: FAKE_USER.id },
        { id: 't-2', task_name: '待回覆留言任務', workspace_id: 'ws-1', rank: '0|i00000:', is_completed: false, priority: 0, notes: '', created_at: 1, updated_at: 1, user_id: FAKE_USER.id },
      ]
      await route.fulfill({ status: 200, json: taskList })
    } else {
      await route.fulfill({ status: 200, json: [] })
    }
  })

  // Rest API mocks for notifications and preferences
  await page.route('**/rest/v1/notifications*', async (route) => {
    const req = route.request()
    const method = req.method()
    const url = req.url()

    if (method === 'GET') {
      await route.fulfill({ status: 200, json: notificationsState })
    } else if (method === 'PATCH') {
      const postData = req.postDataJSON() as { read_at?: number }
      patchCalls.push({ url, body: postData })
      if (url.includes('read_at=is.null')) {
        for (const n of notificationsState) {
          if (n.read_at === null) {
            n.read_at = postData.read_at ?? Date.now()
            n.updated_at = postData.read_at ?? Date.now()
          }
        }
      } else {
        const match = url.match(/id=eq\.([^&]+)/)
        if (match) {
          const id = match[1]
          const target = notificationsState.find((n) => n.id === id)
          if (target) {
            target.read_at = postData.read_at ?? Date.now()
            target.updated_at = postData.read_at ?? Date.now()
          }
        }
      }
      await route.fulfill({ status: 200, json: [] })
    } else {
      await route.fulfill({ status: 200, json: [] })
    }
  })

  await page.route('**/rest/v1/notification_prefs*', async (route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'GET') {
      await route.fulfill({ status: 200, json: [prefsState] })
    } else if (method === 'POST') {
      const postData = req.postDataJSON() as Record<string, unknown>[]
      prefUpsertCalls.push(postData)
      if (postData && postData[0]) {
        Object.assign(prefsState, postData[0])
      }
      await route.fulfill({ status: 200, json: [] })
    } else {
      await route.fulfill({ status: 200, json: [] })
    }
  })

  // Workspace members (to display actor names)
  await page.route('**/rest/v1/workspace_members*', async (route) => {
    await route.fulfill({
      status: 200,
      json: [
        { user_id: 'user-bob', role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
        { user_id: 'user-charlie', role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Charlie', avatar_url: null } },
      ],
    })
  })

  // Mock workspace
  await page.route('**/rest/v1/workspaces*', async (route) => {
    await route.fulfill({
      status: 200,
      json: [
        { id: 'ws-1', name: '我的工作區', created_by: FAKE_USER.id, is_personal: true, created_at: 1, updated_at: 1 },
      ],
    })
  })

  return {
    getNotifications: () => notificationsState,
    getPrefs: () => prefsState,
    getPatchCalls: () => patchCalls,
    getPrefUpsertCalls: () => prefUpsertCalls,
  }
}

async function performLogin(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin
  await page.route('**/auth/v1/authorize*', async (route) => {
    await route.fulfill({ status: 302, headers: { location: `${origin}/?code=e2e-fake-pkce-code` } })
  })

  await page.getByRole('button', { name: '登入以同步' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '帳號與同步' })
  await dialog.getByRole('button', { name: '以 Google 繼續' }).click()
  await expect(page.getByRole('button', { name: '帳號與同步' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
})

test.describe('通知與推播（M4）E2E 測試', () => {
  test('1. 未登入時不顯示通知鈴鐺；登入後顯示通知鈴鐺與未讀數', async ({ page }) => {
    const { getNotifications } = await setupAuthenticatedPage(page)

    // 未登入狀態：header 沒有通知按鈕
    await expect(page.getByRole('button', { name: '通知' })).toHaveCount(0)

    // 登入
    await performLogin(page)

    // 登入後：header 出現通知按鈕
    const notifBtn = page.getByRole('button', { name: '通知' })
    await expect(notifBtn).toBeVisible()

    // 驗證未讀數為 2 則
    expect(getNotifications().filter((n) => n.read_at === null).length).toBe(2)
    await expect(notifBtn).toContainText('2 則未讀')
  })

  test('2. 通知中心：開啟檢視、標單則已讀、未讀數相應減少', async ({ page }) => {
    const { getPatchCalls } = await setupAuthenticatedPage(page)
    await performLogin(page)

    const notifBtn = page.getByRole('button', { name: '通知' })
    await notifBtn.click()

    const notifDialog = page.getByRole('dialog').filter({ hasText: '通知' })
    await expect(notifDialog).toBeVisible()

    // 驗證標題與通知項目內容（成員名稱、事件種類、任務名稱）
    await expect(notifDialog.getByRole('heading', { name: '通知' })).toBeVisible()
    await expect(notifDialog).toContainText('Bob')
    await expect(notifDialog).toContainText('把任務指派給你')
    await expect(notifDialog).toContainText('重要專案規劃')

    await expect(notifDialog).toContainText('Charlie')
    await expect(notifDialog).toContainText('在留言裡提到你')
    await expect(notifDialog).toContainText('待回覆留言任務')

    // 點擊第一則通知（Charlie 提及，因時間較新排在第一列），標記已讀
    const firstItem = notifDialog.locator('li button').first()
    await firstItem.click()

    // 驗證發出 PATCH 請求標記已讀
    await expect.poll(() => getPatchCalls().length).toBeGreaterThanOrEqual(1)
    expect(getPatchCalls()[0]?.url).toContain('id=eq.n-2')

    // 驗證未讀數變成 1
    await expect(notifBtn).toContainText('1 則未讀')

    // 關閉通知中心
    await notifDialog.getByRole('button', { name: '關閉' }).click()
    await expect(notifDialog).not.toBeVisible()
  })

  test('3. 通知中心：全部標為已讀', async ({ page }) => {
    const { getPatchCalls } = await setupAuthenticatedPage(page)
    await performLogin(page)

    const notifBtn = page.getByRole('button', { name: '通知' })
    await notifBtn.click()

    const notifDialog = page.getByRole('dialog').filter({ hasText: '通知' })
    await expect(notifDialog).toBeVisible()

    // 點擊「全部標為已讀」按鈕
    const markAllBtn = notifDialog.getByRole('button', { name: '全部標為已讀' })
    await expect(markAllBtn).toBeVisible()
    await markAllBtn.click()

    // 驗證發出 PATCH 請求帶 read_at=is.null
    await expect.poll(() => getPatchCalls().some((c) => c.url.includes('read_at=is.null'))).toBe(true)

    // 全部已讀後，「全部標為已讀」按鈕應隱藏，未讀計數紅點消失
    await expect(markAllBtn).toHaveCount(0)
    await expect(notifBtn.locator('.bg-accent')).toHaveCount(0)
  })

  test('4. 通知中心：無通知時顯示空狀態', async ({ page }) => {
    await setupAuthenticatedPage(page, { notifications: [] })
    await performLogin(page)

    const notifBtn = page.getByRole('button', { name: '通知' })
    await notifBtn.click()

    const notifDialog = page.getByRole('dialog').filter({ hasText: '通知' })
    await expect(notifDialog).toBeVisible()
    await expect(notifDialog).toContainText('還沒有通知')
    await expect(notifDialog.getByRole('button', { name: '全部標為已讀' })).toHaveCount(0)
  })

  test('5. 通知偏好：可個別開啟／關閉提及、指派與每日摘要信', async ({ page }) => {
    const { getPrefs, getPrefUpsertCalls } = await setupAuthenticatedPage(page, {
      prefs: { notify_on_mention: true, notify_on_assignment: true, daily_digest_enabled: false },
    })
    await performLogin(page)

    // 開啟「資料與提醒」對話框
    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dataDialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    await expect(dataDialog).toBeVisible()

    // 驗證通知偏好區塊與三個勾選框
    await expect(dataDialog.getByRole('heading', { name: '通知偏好' })).toBeVisible()
    const mentionCheckbox = dataDialog.getByLabel('被留言 @提及時通知我')
    const assignmentCheckbox = dataDialog.getByLabel('被指派任務時通知我')
    const digestCheckbox = dataDialog.getByLabel('每天寄一封摘要信')

    await expect(mentionCheckbox).toBeChecked()
    await expect(assignmentCheckbox).toBeChecked()
    await expect(digestCheckbox).not.toBeChecked()

    // 關閉提及通知
    await mentionCheckbox.uncheck()
    await expect.poll(() => getPrefUpsertCalls().length).toBeGreaterThanOrEqual(1)
    expect(getPrefs().notify_on_mention).toBe(false)

    // 關閉指派通知
    await assignmentCheckbox.uncheck()
    await expect.poll(() => getPrefUpsertCalls().length).toBeGreaterThanOrEqual(2)
    expect(getPrefs().notify_on_assignment).toBe(false)

    // 開啟每日摘要信
    await digestCheckbox.check()
    await expect.poll(() => getPrefUpsertCalls().length).toBeGreaterThanOrEqual(3)
    expect(getPrefs().daily_digest_enabled).toBe(true)

    // 關閉對話框後重新打開，驗證狀態保持
    await dataDialog.getByRole('button', { name: '關閉' }).click()
    await expect(dataDialog).not.toBeVisible()

    await page.getByRole('button', { name: '資料與提醒' }).click()
    await expect(mentionCheckbox).not.toBeChecked()
    await expect(assignmentCheckbox).not.toBeChecked()
    await expect(digestCheckbox).toBeChecked()
  })

  test('6. 通知偏好更新失敗時，自動回滾並顯示錯誤提示', async ({ page }) => {
    await setupAuthenticatedPage(page)
    await performLogin(page)

    // 攔截 notification_prefs POST 使其回傳 500
    await page.route('**/rest/v1/notification_prefs*', async (route) => {
      const method = route.request().method()
      if (method === 'POST') {
        await route.fulfill({ status: 500, body: 'Internal Server Error' })
      } else {
        await route.fulfill({
          status: 200,
          json: [{ notify_on_mention: true, notify_on_assignment: true, daily_digest_enabled: false }],
        })
      }
    })

    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dataDialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    const mentionCheckbox = dataDialog.getByLabel('被留言 @提及時通知我')

    // 取消勾選提及（點擊觸發變更並預期失敗回滾）
    await mentionCheckbox.click()

    // 驗證錯誤提示出現，且勾選框回滾為已勾選
    await expect(dataDialog.getByRole('alert')).toContainText('更新通知偏好失敗，請稍後再試一次')
    await expect(mentionCheckbox).toBeChecked()
  })
})
