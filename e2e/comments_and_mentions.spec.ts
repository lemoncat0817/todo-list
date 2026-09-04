import { test, expect, type Page } from '@playwright/test'

const USER_ALICE = { id: 'user-alice', email: 'alice@example.com' }
const USER_BOB = { id: 'user-bob', email: 'bob@example.com' }

function fakeSession(user = USER_ALICE) {
  return {
    access_token: `token-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
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

async function setupPage(
  page: Page,
  options: {
    currentUser?: typeof USER_ALICE
    tasks?: { id: string; task_name: string; workspace_id?: string; rank?: string; is_completed?: boolean; priority?: number; notes?: string; created_at?: number; updated_at?: number; user_id?: string }[]
    initialComments?: {
      id: string
      task_id: string
      author_id: string
      body: string
      mentioned_user_ids: string[]
      created_at: number
      updated_at: number
    }[]
    notifications?: MockNotification[]
  } = {},
) {
  const currentUser = options.currentUser ?? USER_ALICE
  const session = fakeSession(currentUser)

  const tasksList = options.tasks ?? [
    {
      id: 'task-101',
      task_name: 'M3 留言功能測試任務',
      workspace_id: 'ws-1',
      rank: '0|hzzzzz:',
      is_completed: false,
      priority: 0,
      notes: '',
      created_at: 1,
      updated_at: 1,
      user_id: USER_ALICE.id,
    },
  ]

  const commentsState = options.initialComments ? [...options.initialComments] : []
  const notificationsState = options.notifications ? [...options.notifications] : []
  const rpcCalls: { fn: string; body: unknown }[] = []

  // Auth mock
  await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
    await route.fulfill({ status: 200, json: session })
  })
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204 })
  })

  // 1. General Fallback registered FIRST so specific routes registered later take precedence (LIFO)
  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({ status: 200, json: [] })
  })

  // 2. Specific routes
  await page.route('**/rest/v1/tasks*', async (route) => {
    await route.fulfill({ status: 200, json: tasksList })
  })

  await page.route('**/rest/v1/workspaces*', async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ id: 'ws-1', name: '專案工作區', created_by: currentUser.id, is_personal: true, created_at: 1, updated_at: 1 }],
    })
  })

  await page.route('**/rest/v1/workspace_members*', async (route) => {
    await route.fulfill({
      status: 200,
      json: [
        { user_id: USER_ALICE.id, role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
        { user_id: USER_BOB.id, role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
        { user_id: 'user-charlie', role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Charlie', avatar_url: null } },
      ],
    })
  })

  await page.route('**/rest/v1/comments*', async (route) => {
    await route.fulfill({ status: 200, json: commentsState })
  })

  await page.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url()
    const fn = url.split('/rpc/')[1]?.split('?')[0] ?? ''
    const postData = route.request().postDataJSON() as Record<string, unknown>
    rpcCalls.push({ fn, body: postData })
    await route.fulfill({ status: 200, json: [] })
  })

  await page.route('**/rest/v1/notifications*', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') {
      await route.fulfill({ status: 200, json: notificationsState.filter((n) => n.user_id === currentUser.id) })
    } else if (req.method() === 'PATCH') {
      const postData = req.postDataJSON() as { read_at?: number }
      for (const n of notificationsState) {
        if (n.user_id === currentUser.id && n.read_at === null) {
          n.read_at = postData.read_at ?? Date.now()
        }
      }
      await route.fulfill({ status: 200, json: [] })
    } else {
      await route.fulfill({ status: 200, json: [] })
    }
  })

  await page.route('**/rest/v1/notification_prefs*', async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ notify_on_mention: true, notify_on_assignment: true, daily_digest_enabled: false }],
    })
  })

  return {
    rpcCalls,
    commentsState,
    notificationsState,
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

test.describe('留言與 @提及（M3）E2E 測試', () => {
  test('1. 新增、編輯、刪除自己的留言完整流程', async ({ page }) => {
    await setupPage(page)
    await performLogin(page)
    await page.goto('/#/all')

    // 開啟任務詳情
    await page.getByRole('button', { name: '設定「M3 留言功能測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail).toBeVisible()

    // 留言區初始狀態顯示「還沒有人留言」
    await expect(detail.getByText('還沒有人留言')).toBeVisible()

    // 輸入新留言
    const commentInput = detail.locator('#new-comment-task-101')
    await commentInput.fill('這是一則測試留言')
    const submitBtn = detail.getByRole('button', { name: '留言' })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // 留言成功新增：清空輸入框，清單出現留言
    await expect(commentInput).toHaveValue('')
    const commentList = detail.locator('ul li')
    await expect(commentList).toHaveCount(1)
    await expect(commentList.first()).toContainText('這是一則測試留言')
    await expect(commentList.first()).toContainText('我')

    // 自己的留言具備「編輯」與「刪除」按鈕
    const editBtn = commentList.first().getByRole('button', { name: '編輯' })
    const deleteBtn = commentList.first().getByRole('button', { name: '刪除' })
    await expect(editBtn).toBeVisible()
    await expect(deleteBtn).toBeVisible()

    // 點擊「編輯」，輸入框帶入原內容
    await editBtn.click()
    const editInput = detail.getByLabel('編輯留言')
    await expect(editInput).toHaveValue('這是一則測試留言')

    // 修改文字並儲存
    await editInput.fill('這是一則已修改的測試留言')
    await commentList.first().getByRole('button', { name: '儲存' }).click()

    // 驗證內容更新並標示「（已編輯）」
    await expect(commentList.first()).toContainText('這是一則已修改的測試留言')
    await expect(commentList.first()).toContainText('（已編輯）')

    // 點擊「刪除」留言
    await deleteBtn.click()

    // 留言自清單消失，回到「還沒有人留言」
    await expect(detail.getByText('還沒有人留言')).toBeVisible()
    await expect(commentList).toHaveCount(0)
  })

  test('2. 他人的留言不可編輯或刪除', async ({ page }) => {
    // 預先載入一則 Bob 的留言
    await setupPage(page, {
      initialComments: [
        {
          id: 'c-bob-1',
          task_id: 'task-101',
          author_id: USER_BOB.id,
          body: 'Bob 發送的協作留言',
          mentioned_user_ids: [],
          created_at: Date.now() - 60000,
          updated_at: Date.now() - 60000,
        },
      ],
    })
    await performLogin(page)
    await page.goto('/#/all')

    await page.getByRole('button', { name: '設定「M3 留言功能測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail).toBeVisible()

    const bobComment = detail.locator('ul li').first()
    await expect(bobComment).toContainText('Bob')
    await expect(bobComment).toContainText('Bob 發送的協作留言')

    // Bob 的留言不應顯示「編輯」或「刪除」按鈕
    await expect(bobComment.getByRole('button', { name: '編輯' })).not.toBeVisible()
    await expect(bobComment.getByRole('button', { name: '刪除' })).not.toBeVisible()
  })

  test('3. @成員 自動完成選單與送出後的提及標記', async ({ page }) => {
    await setupPage(page)
    await performLogin(page)
    await page.goto('/#/all')

    await page.getByRole('button', { name: '設定「M3 留言功能測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail).toBeVisible()

    const commentInput = detail.locator('#new-comment-task-101')
    await commentInput.focus()

    // 輸入 @ 符號，跳出工作區成員建議選單
    await commentInput.pressSequentially('@')
    const suggestionMenu = detail.locator('ul.absolute')
    await expect(suggestionMenu).toBeVisible()
    const suggestionList = suggestionMenu.locator('li')
    await expect(suggestionList).toHaveCount(3)
    await expect(suggestionList).toContainText(['Alice', 'Bob', 'Charlie'])

    // 輸入 B 過濾出 Bob
    await commentInput.pressSequentially('B')
    await expect(suggestionList).toHaveCount(1)
    await expect(suggestionList.first()).toContainText('Bob')

    // 點擊建議項目完成選取
    await suggestionList.first().getByRole('button').click()

    // 驗證輸入框自動替換成 @Bob 加一個空格
    await expect(commentInput).toHaveValue('@Bob ')

    // 接續輸入訊息
    await commentInput.pressSequentially('請查看這項規格需求')

    // 送出留言
    await detail.getByRole('button', { name: '留言' }).click()

    // 驗證送出的留言中 @Bob 具有提及樣式標記（class bg-accent-soft）
    const commentItem = detail.locator('ul.flex-col > li').first()
    const mentionBadge = commentItem.locator('.bg-accent-soft')
    await expect(mentionBadge).toBeVisible()
    await expect(mentionBadge).toHaveText('@Bob')
    await expect(commentItem).toContainText('請查看這項規格需求')
  })

  test('4. 被提及者收到通知中心通知，點擊可標記已讀', async ({ page }) => {
    // 模擬 Bob 登入，並有一則被 Alice 提及的通知
    await setupPage(page, {
      currentUser: USER_BOB,
      notifications: [
        {
          id: 'n-mention-bob',
          user_id: USER_BOB.id,
          actor_id: USER_ALICE.id,
          kind: 'mention',
          task_id: 'task-101',
          detail: { body: '@Bob 請查看這項規格需求' },
          read_at: null,
          created_at: Date.now() - 1000 * 30,
          updated_at: Date.now() - 1000 * 30,
        },
      ],
    })
    await performLogin(page)

    // Bob 畫面 Header 應出現鈴鐺並顯示 1 則未讀
    const notifBtn = page.getByRole('button', { name: '通知' })
    await expect(notifBtn).toBeVisible()
    await expect(notifBtn).toContainText('1 則未讀')

    // 點擊鈴鐺開啟通知中心
    await notifBtn.click()
    const notifDialog = page.getByRole('dialog').filter({ hasText: '通知' })
    await expect(notifDialog).toBeVisible()

    // 驗證通知內文包含提及者、提及事件與對應任務
    await expect(notifDialog).toContainText('Alice')
    await expect(notifDialog).toContainText('在留言裡提到你')
    await expect(notifDialog).toContainText('M3 留言功能測試任務')

    // 點擊通知標記為已讀
    const notifItem = notifDialog.locator('li button').first()
    await notifItem.click()

    // 未讀數歸零
    await expect(notifBtn).not.toContainText('1 則未讀')

    // 關閉通知中心
    await notifDialog.getByRole('button', { name: '關閉' }).click()
    await expect(notifDialog).not.toBeVisible()
  })
})
