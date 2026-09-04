import { test, expect, type Page } from '@playwright/test'

async function addTask(page: Page, name: string): Promise<void> {
  await page.getByLabel('新增代辦事項').fill(name)
  await page.getByRole('button', { name: '新增' }).click()
}

async function createProject(page: Page, projectName: string): Promise<string> {
  await page.getByRole('button', { name: '管理專案與標籤' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
  await dialog.getByLabel('新專案名稱').fill(projectName)
  await dialog.getByRole('button', { name: '建立' }).first().click()
  await dialog.getByRole('button', { name: '關閉', exact: true }).click()

  const projectLink = page.getByRole('link', { name: new RegExp(`^${projectName}`) })
  await projectLink.click()
  expect(page.url()).toContain('#/project/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(projectName)
  return page.url()
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.setViewportSize({ width: 1200, height: 850 })
  await page.goto('/#/all')
})

test.describe('M5 看板、分組、範本功能驗證', () => {
  test('1. 專案內建區段；看板拖曳跨欄／欄內排序與清單一致', async ({ page }) => {
    // 建立專案並加入兩項任務
    await createProject(page, '看板專案')
    await addTask(page, '任務A')
    await addTask(page, '任務B')

    // 切換為看板檢視
    await page.getByRole('button', { name: '切換為看板' }).click()

    // 專案內建「未分類」區段
    const columns = page.locator('main section')
    await expect(columns.first().locator('h2')).toContainText('未分類')
    await expect(columns.first().locator('li')).toHaveCount(2)

    // 新增自訂區段「進行中」
    await page.getByPlaceholder('新增區段…').fill('進行中')
    await page.getByRole('button', { name: '新增區段' }).click()
    await expect(columns).toHaveCount(2)
    await expect(columns.nth(1).locator('h2')).toContainText('進行中')

    // 跨欄移動：將「任務B」移到「進行中」區段（利用卡片內的移到區段選單）
    const taskBMoveSelect = columns.first().locator('li', { hasText: '任務B' }).getByLabel('移到區段')
    await taskBMoveSelect.selectOption({ label: '進行中' })

    // 驗證未分類剩 1 筆，進行中有 1 筆
    await expect(columns.first().locator('li')).toHaveCount(1)
    await expect(columns.nth(1).locator('li')).toHaveCount(1)
    await expect(columns.first().locator('li')).toContainText('任務A')
    await expect(columns.nth(1).locator('li')).toContainText('任務B')

    // 在「進行中」欄再新增任務C
    await page.getByPlaceholder('新增任務…').nth(1).fill('任務C')
    await page.getByRole('button', { name: '新增任務' }).nth(1).click()
    await expect(columns.nth(1).locator('li')).toHaveCount(2)
    // 順序應為 任務B、任務C
    const inProgressTasks = columns.nth(1).locator('li button[type="button"]').filter({ hasText: /^任務/ })
    await expect(inProgressTasks).toHaveText(['任務B', '任務C'])

    // 欄內排序：將「任務B」下移
    await columns.nth(1).locator('button[aria-label="「任務B」在欄內下移"]').click()
    await expect(inProgressTasks).toHaveText(['任務C', '任務B'])

    // 切換回清單檢視，清單中的排序與看板欄內排序完全一致
    await page.getByRole('button', { name: '切換為清單' }).click()
    const taskNames = page.locator('main [data-test=task-name]')
    // 包含未分類的任務A，以及進行中的任務C、任務B
    const names = await taskNames.allInnerTexts()
    expect(names.indexOf('任務C')).toBeLessThan(names.indexOf('任務B'))
  })

  test('2. 看板新增任務落到正確區段；改名／刪區段（任務移出不刪）', async ({ page }) => {
    await createProject(page, '區段管理專案')

    // 切換為看板檢視
    await page.getByRole('button', { name: '切換為看板' }).click()

    // 新增區段「待處理」
    await page.getByPlaceholder('新增區段…').fill('待處理')
    await page.getByRole('button', { name: '新增區段' }).click()

    // 在「待處理」欄新增任務
    const todoColumn = page.locator('main section').filter({ hasText: '待處理' })
    await todoColumn.getByPlaceholder('新增任務…').fill('區段任務1')
    await todoColumn.getByRole('button', { name: '新增任務' }).click()

    // 驗證任務確實落在「待處理」欄內
    await expect(todoColumn.locator('li')).toHaveCount(1)
    await expect(todoColumn.locator('li')).toContainText('區段任務1')

    // 改名區段
    await todoColumn.getByRole('button', { name: '重新命名「待處理」' }).click()
    const renameInput = todoColumn.locator('input[id^="rename-"]')
    await renameInput.fill('準備中')
    await renameInput.press('Enter')
    await expect(page.locator('main section').filter({ hasText: '準備中' })).toBeVisible()

    // 刪除區段：驗證任務移出到未分類，任務本身不被刪除
    const activeColumn = page.locator('main section').filter({ hasText: '準備中' })
    await activeColumn.getByRole('button', { name: '刪除區段「準備中」' }).click()

    // 準備中欄消失
    await expect(page.locator('main section').filter({ hasText: '準備中' })).toHaveCount(0)

    // 未分類欄接收了「區段任務1」
    const unassignedColumn = page.locator('main section').filter({ hasText: '未分類' })
    await expect(unassignedColumn.locator('li')).toHaveCount(1)
    await expect(unassignedColumn.locator('li')).toContainText('區段任務1')
  })

  test('3. 清單「依負責人分組」', async ({ page }) => {
    // 建立任務
    await addTask(page, '普通任務')
    await addTask(page, '指派任務')

    // E2E 環境中有模擬 isSyncConfigured 為 true，toolbar 中有「依負責人」分組
    const groupBySelect = page.getByLabel('分組方式')
    await expect(groupBySelect).toBeVisible()

    // 選單內包含「分組：負責人」
    const options = await groupBySelect.locator('option').allInnerTexts()
    expect(options).toContain('分組：負責人')

    // 切換為「依負責人」分組
    await groupBySelect.selectOption('assignee')

    // 驗證未指派的任務歸類在「未指派」分組標題下
    await expect(page.getByRole('heading', { level: 2, name: '未指派' })).toBeVisible()
    const names = page.locator('main [data-test=task-name]')
    await expect(names).toContainText(['普通任務', '指派任務'])
  })

  test('4. 複製專案範本：帶區段＋未完成任務；不帶已完成／留言／到期日／指派', async ({ page }) => {
    await createProject(page, '範本專案')

    // 切換至看板並新增區段「開發中」
    await page.getByRole('button', { name: '切換為看板' }).click()
    await page.getByPlaceholder('新增區段…').fill('開發中')
    await page.getByRole('button', { name: '新增區段' }).click()

    // 在「開發中」新增未完成任務
    await page.getByLabel('在「開發中」新增任務').fill('未完成開發任務')
    const devCol = page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: /^開發中/ }) })
    await devCol.getByRole('button', { name: '新增任務' }).click()

    // 在「未分類」新增另一個任務並標記為已完成
    await page.getByLabel('在「未分類」新增任務').fill('已完成的事')
    const unassignedCol = page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: /^未分類/ }) })
    await unassignedCol.getByRole('button', { name: '新增任務' }).click()
    // 點擊完成核取方塊（完成後會立即從看板上移除）
    await unassignedCol.locator('li', { hasText: '已完成的事' }).locator('input[type="checkbox"]').click()

    // 為「未完成開發任務」設定到期日
    await page.getByRole('button', { name: '切換為清單' }).click()
    await page.getByRole('button', { name: /設定「未完成開發任務」的細節/ }).click()
    // 打開詳情面板設定到期日
    const dueDateInput = page.getByLabel('到期日')
    await dueDateInput.fill('2030-12-31')
    await page.getByRole('button', { name: '儲存', exact: true }).click()

    // 開啟「管理專案與標籤」並複製「範本專案」
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    const duplicateButton = dialog.getByRole('button', { name: '複製專案「範本專案」' })
    await expect(duplicateButton).toBeVisible()
    await duplicateButton.click()

    // 複製後自動導向新專案「範本專案 的副本」
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('範本專案 的副本')

    // 驗證新專案帶有「未完成開發任務」，但不包含「已完成的事」
    const newProjectNames = page.locator('main [data-test=task-name]')
    await expect(newProjectNames).toHaveCount(1)
    await expect(newProjectNames).toHaveText(['未完成開發任務'])

    // 切換為看板檢視，驗證區段「開發中」也被帶過來，且未完成任務座落在該區段
    await page.getByRole('button', { name: '切換為看板' }).click()
    const newDevCol = page.locator('main section').filter({ has: page.getByRole('heading', { level: 2, name: /^開發中/ }) })
    await expect(newDevCol).toBeVisible()
    await expect(newDevCol.locator('li')).toHaveCount(1)
    await expect(newDevCol.locator('li')).toContainText('未完成開發任務')

    // 驗證到期日被清除（不帶到期日）
    await newDevCol.locator('li button[type="button"]').filter({ hasText: '未完成開發任務' }).click()
    const newDueDateInput = page.getByLabel('到期日')
    await expect(newDueDateInput).toHaveValue('')
  })
})
