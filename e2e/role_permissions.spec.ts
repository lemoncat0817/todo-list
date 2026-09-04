import { test, expect, type Page } from '@playwright/test'

const USER_ALICE = { id: 'user-alice', email: 'alice@example.com' }
const USER_BOB = { id: 'user-bob', email: 'bob@example.com' }

function fakeSession(user = USER_BOB) {
  return {
    access_token: `token-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
}

interface SetupOptions {
  bobRole?: 'admin' | 'member' | 'commenter' | 'viewer'
}

async function setupRoleTestPage(page: Page, options: SetupOptions = {}) {
  let bobRole = options.bobRole ?? 'member'

  const session = fakeSession(USER_BOB)

  const workspacesList = [
    { id: 'shared-ws', name: '團隊共享區', created_by: USER_ALICE.id, is_personal: false, created_at: 1, updated_at: 1 },
    { id: 'bob-personal', name: 'Bob 的個人工作區', created_by: USER_BOB.id, is_personal: true, created_at: 1, updated_at: 1 },
  ]

  const tasksList = [
    {
      id: 'task-test-1',
      task_name: '權限測試任務',
      workspace_id: 'shared-ws',
      rank: '0|hzzzzz:',
      is_completed: false,
      priority: 0,
      notes: '測試備註內容',
      created_at: 1,
      updated_at: 1,
      user_id: USER_ALICE.id,
    },
  ]

  const projectsList = [
    { id: 'proj-1', name: '團隊專案', color: '#3b82f6', rank: '0|hzzzzz:', is_inbox: false, workspace_id: 'shared-ws', created_at: 1, updated_at: 1 },
  ]

  const tagsList = [
    { id: 'tag-1', name: '團隊標籤', color: '#10b981', workspace_id: 'shared-ws', created_at: 1, updated_at: 1 },
  ]

  // Auth mock
  await page.route('**/auth/v1/token?grant_type=pkce', async (route) => {
    await route.fulfill({ status: 200, json: session })
  })
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204 })
  })

  // Fallback
  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({ status: 200, json: [] })
  })

  await page.route('**/rest/v1/workspaces*', async (route) => {
    await route.fulfill({ status: 200, json: workspacesList })
  })

  await page.route('**/rest/v1/workspace_members*', async (route) => {
    const url = route.request().url()
    if (url.includes('workspace_id=eq.bob-personal')) {
      await route.fulfill({
        status: 200,
        json: [
          { user_id: USER_BOB.id, role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
        ],
      })
    } else {
      await route.fulfill({
        status: 200,
        json: [
          { user_id: USER_ALICE.id, role: 'owner', joined_at: '2026-01-01', profiles: { display_name: 'Alice', avatar_url: null } },
          { user_id: USER_BOB.id, role: bobRole, joined_at: '2026-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
          { user_id: 'user-charlie', role: 'member', joined_at: '2026-01-01', profiles: { display_name: 'Charlie', avatar_url: null } },
        ],
      })
    }
  })

  await page.route('**/rest/v1/tasks*', async (route) => {
    await route.fulfill({ status: 200, json: tasksList })
  })

  await page.route('**/rest/v1/projects*', async (route) => {
    await route.fulfill({ status: 200, json: projectsList })
  })

  await page.route('**/rest/v1/tags*', async (route) => {
    await route.fulfill({ status: 200, json: tagsList })
  })

  await page.route('**/rest/v1/comments*', async (route) => {
    await route.fulfill({ status: 200, json: [] })
  })

  await page.route('**/rest/v1/task_attachments*', async (route) => {
    await route.fulfill({ status: 200, json: [] })
  })

  return {
    setBobRole: (newRole: 'admin' | 'member' | 'commenter' | 'viewer') => {
      bobRole = newRole
    },
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
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/#/all')
})

test.describe('角色權限 E2E 完整功能驗證', () => {
  test('1. member：可改任務／標籤／留言／附件；不可管專案與成員', async ({ page }) => {
    await setupRoleTestPage(page, { bobRole: 'member' })
    await performLogin(page)
    await page.goto('/#/all')

    // 切換到團隊共享區
    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })

    // (1) 可改任務：快速新增框存在
    await expect(page.getByLabel('新增代辦事項')).toBeVisible()

    // (2) 可改任務：開啟任務詳情，表單未被 disabled，且可見儲存按鈕
    await page.getByRole('button', { name: '設定「權限測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail).toBeVisible()
    await expect(detail.locator('fieldset').first()).not.toBeDisabled()
    await expect(detail.getByRole('button', { name: '儲存' })).toBeVisible()

    // (3) 可留言：留言輸入框存在
    await expect(detail.locator('#new-comment-task-test-1')).toBeVisible()

    // (4) 可改附件：新增附件標籤按鈕存在
    await expect(detail.getByText('新增附件')).toBeVisible()

    // (5) 可改標籤、不可管專案：開啟管理專案與標籤
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const collDialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await expect(collDialog).toBeVisible()
    // 標籤可改：
    await expect(collDialog.locator('#tag-name-tag-1')).toBeEnabled()
    await expect(collDialog.locator('#new-tag')).toBeVisible()
    // 專案不可管：
    await expect(collDialog.locator('#project-name-proj-1')).toBeDisabled()
    await expect(collDialog.locator('#new-project')).toBeHidden()
    await collDialog.getByRole('button', { name: '關閉' }).click()

    // (6) 不可管成員：打開成員對話框，無更改角色與移除按鈕、無邀請表單
    await page.getByRole('button', { name: '工作區成員' }).click()
    const memDialog = page.locator('dialog[open]').filter({ hasText: '成員' })
    await expect(memDialog).toBeVisible()
    await expect(memDialog.locator('#role-user-alice')).toBeHidden()
    await expect(memDialog.locator('#role-user-charlie')).toBeHidden()
    await expect(memDialog.getByRole('button', { name: /移除成員/ })).toBeHidden()
    await expect(memDialog.locator('#invite-email')).toBeHidden()
  })

  test('2. commenter：任務唯讀；可留言；不可上傳附件／改專案', async ({ page }) => {
    await setupRoleTestPage(page, { bobRole: 'commenter' })
    await performLogin(page)
    await page.goto('/#/all')

    // 切換到團隊共享區
    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })

    // (1) 任務唯讀：快速新增框不見，頂部顯示提示
    await expect(page.getByLabel('新增代辦事項')).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: '你目前是僅留言，可以留言但不能改任務' })).toBeVisible()

    // (2) 任務唯讀：核取方塊 disabled
    await expect(page.locator('input.task-complete-checkbox').first()).toBeDisabled()

    // (3) 任務唯讀：開啟任務詳情，表單被 disabled，儲存按鈕隱藏，顯示權限說明
    await page.getByRole('button', { name: '設定「權限測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail.locator('fieldset').first()).toHaveAttribute('disabled')
    await expect(detail.locator('input').first()).toBeDisabled()
    await expect(detail.getByRole('button', { name: '儲存' })).toBeHidden()
    await expect(detail.getByRole('status').filter({ hasText: '你目前是僅留言，可以留言但不能改任務' })).toBeVisible()

    // (4) 可留言：留言輸入框仍存在
    await expect(detail.locator('#new-comment-task-test-1')).toBeVisible()

    // (5) 不可上傳附件：無新增附件按鈕
    await expect(detail.getByText('新增附件')).toBeHidden()
  })

  test('3. viewer：不能新增／勾選／編輯／刪除／拖曳；無留言輸入框；有權限說明', async ({ page }) => {
    await setupRoleTestPage(page, { bobRole: 'viewer' })
    await performLogin(page)
    await page.goto('/#/all')

    // 切換到團隊共享區
    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })

    // (1) 不能新增任務／有權限說明
    await expect(page.getByLabel('新增代辦事項')).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: '你目前是僅檢視，只能看任務，無法編輯或留言' })).toBeVisible()

    // (2) 不能勾選：checkbox disabled
    await expect(page.locator('input.task-complete-checkbox').first()).toBeDisabled()

    // (3) 不能編輯與不能刪除：列上的編輯按鈕與刪除按鈕隱藏
    const taskRow = page.locator('main li[data-test=task-row]').first()
    await expect(taskRow.getByRole('button', { name: /編輯/ })).toBeHidden()
    await expect(taskRow.getByRole('button', { name: /刪除/ })).toBeHidden()

    // (4) 不能拖曳：draggable 為 false
    await expect(taskRow).toHaveAttribute('draggable', 'false')

    // (5) 詳情頁：不能編輯（fieldset disabled，無儲存按鈕，有權限說明）
    await page.getByRole('button', { name: '設定「權限測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail.locator('fieldset').first()).toHaveAttribute('disabled')
    await expect(detail.locator('input').first()).toBeDisabled()
    await expect(detail.getByRole('button', { name: '儲存' })).toBeHidden()
    await expect(detail.getByRole('status').filter({ hasText: '你目前是僅檢視，只能看任務，無法編輯或留言' })).toBeVisible()

    // (6) 無留言輸入框
    await expect(detail.locator('#new-comment-task-test-1')).toBeHidden()
  })

  test('4. admin：可管專案與成員；可寫任務', async ({ page }) => {
    await setupRoleTestPage(page, { bobRole: 'admin' })
    await performLogin(page)
    await page.goto('/#/all')

    // 切換到團隊共享區
    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })

    // (1) 可寫任務：快速新增框存在
    await expect(page.getByLabel('新增代辦事項')).toBeVisible()

    // (2) 可管專案：開啟專案與標籤，專案名稱輸入框 enabled，新增專案存在
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const collDialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await expect(collDialog).toBeVisible()
    await expect(collDialog.locator('#project-name-proj-1')).toBeEnabled()
    await expect(collDialog.locator('#new-project')).toBeVisible()
    await collDialog.getByRole('button', { name: '關閉' }).click()

    // (3) 可管成員：開啟成員對話框，顯示角色選單、移除成員按鈕、邀請新成員表單
    await page.getByRole('button', { name: '工作區成員' }).click()
    const memDialog = page.locator('dialog[open]').filter({ hasText: '成員' })
    await expect(memDialog).toBeVisible()
    await expect(memDialog.locator('#role-user-charlie')).toBeVisible()
    await expect(memDialog.locator('button[aria-label="移除成員「Charlie」"]')).toBeVisible()
    await expect(memDialog.locator('#invite-email')).toBeVisible()
  })

  test('5. A 把 B 降權時，B 開著的分頁幾秒內鎖上（不必手動重整）', async ({ page }) => {
    const { setBobRole } = await setupRoleTestPage(page, { bobRole: 'member' })
    await performLogin(page)
    await page.goto('/#/all')

    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })

    // 開啟任務詳情（處於 member 可寫狀態）
    await page.getByRole('button', { name: '設定「權限測試任務」的細節' }).click()
    const detail = page.getByRole('complementary', { name: '任務詳情' })
    await expect(detail.locator('fieldset').first()).not.toBeDisabled()
    await expect(detail.getByRole('button', { name: '儲存' })).toBeVisible()
    await expect(detail.locator('#new-comment-task-test-1')).toBeVisible()

    // 模擬後端／Realtime 廣播：A 將 B 降權為 viewer
    setBobRole('viewer')

    // 觸發成員名單重新整理（模擬 Realtime onMembersChange 觸發 workspace.loadMembers()）
    await page.evaluate(() => {
      const select = document.querySelector('aside select') as HTMLSelectElement
      if (select) select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // 驗證分頁無須手動 reload 即刻響應式鎖上
    await expect(detail.locator('fieldset').first()).toHaveAttribute('disabled', '', { timeout: 5000 })
    await expect(detail.locator('input').first()).toBeDisabled()
    await expect(detail.getByRole('button', { name: '儲存' })).toBeHidden()
    await expect(detail.locator('#new-comment-task-test-1')).toBeHidden()
    await expect(detail.getByRole('status').filter({ hasText: '你目前是僅檢視，只能看任務，無法編輯或留言' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: '你目前是僅檢視，只能看任務，無法編輯或留言' })).toBeVisible()
  })

  test('6. B 在自己的個人工作區仍可完整編輯（不受共享區角色影響）', async ({ page }) => {
    await setupRoleTestPage(page, { bobRole: 'viewer' })
    await performLogin(page)
    await page.goto('/#/all')

    // (1) 在團隊共享區中是 viewer：唯讀受限
    const wsSelect = page.getByRole('combobox', { name: '工作區' })
    await expect(wsSelect).toBeVisible()
    await wsSelect.selectOption({ label: '團隊共享區' })
    await expect(page.getByLabel('新增代辦事項')).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: '你目前是僅檢視' })).toBeVisible()

    // (2) 切換回 Bob 的個人工作區（Bob 是 owner）
    await wsSelect.selectOption({ label: 'Bob 的個人工作區' })

    // 驗證在個人工作區中權限完全解鎖：可新增任務
    await expect(page.getByLabel('新增代辦事項')).toBeVisible()
    await page.getByLabel('新增代辦事項').fill('個人秘密專屬任務')
    await page.getByRole('button', { name: '新增' }).click()
    await expect(page.locator('main [data-test=task-name]').filter({ hasText: '個人秘密專屬任務' })).toBeVisible()

    // 驗證個人工作區可管理專案與標籤
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const collDialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await expect(collDialog).toBeVisible()
    await expect(collDialog.locator('#new-project')).toBeVisible()
    await expect(collDialog.locator('#new-tag')).toBeVisible()
    await collDialog.getByRole('button', { name: '關閉' }).click()

    // (3) 再次切換回共享工作區，viewer 限制立刻重新生效
    await wsSelect.selectOption({ label: '團隊共享區' })
    await expect(page.getByLabel('新增代辦事項')).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: '你目前是僅檢視' })).toBeVisible()
  })
})
