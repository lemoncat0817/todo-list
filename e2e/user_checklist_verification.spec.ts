import { test, expect, type Page } from '@playwright/test'

async function addTask(page: Page, name: string): Promise<void> {
  await page.getByLabel('新增代辦事項').fill(name)
  await page.getByRole('button', { name: '新增' }).click()
}

const rows = (page: Page) => page.locator('main li[data-test=task-row]')
const names = (page: Page) => page.locator('main [data-test=task-name]')

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/#/all')
})

test.describe('排序／分組／篩選器', () => {
  test('1. 切換排序：手動／到期日／優先度／名稱／建立時間，重新整理後設定還在（不影響網址）', async ({ page }) => {
    await addTask(page, '任務B 明天 p2')
    await addTask(page, '任務A 今天 p1')
    await addTask(page, '任務C 後天 p3')

    // 切換排序至「到期日」
    await page.getByLabel('排序方式').selectOption('due')
    expect(page.url()).not.toContain('sort=')
    await expect(names(page)).toHaveText(['任務A', '任務B', '任務C'])

    // 切換排序至「優先度」 (P1=3, P2=2, P3=1, P4=0)
    await page.getByLabel('排序方式').selectOption('priority')
    expect(page.url()).not.toContain('sort=')
    await expect(names(page)).toHaveText(['任務A', '任務B', '任務C'])

    // 切換排序至「名稱」
    await page.getByLabel('排序方式').selectOption('name')
    expect(page.url()).not.toContain('sort=')
    await expect(names(page)).toHaveText(['任務A', '任務B', '任務C'])

    // 切換排序至「建立時間」
    await page.getByLabel('排序方式').selectOption('created')
    expect(page.url()).not.toContain('sort=')
    await expect(names(page)).toHaveText(['任務C', '任務A', '任務B'])

    // 切換回「手動」
    await page.getByLabel('排序方式').selectOption('manual')
    expect(page.url()).not.toContain('sort=')

    // 重新整理後偏好設定依然保留
    await page.getByLabel('排序方式').selectOption('due')
    await page.reload()
    await expect(page.getByLabel('排序方式')).toHaveValue('due')
    await expect(names(page)).toHaveText(['任務A', '任務B', '任務C'])
    expect(page.url()).not.toContain('sort=')
  })

  test('2. 切換分組：不分組／專案／優先度', async ({ page }) => {
    // 建立含專案與優先度的任務
    await addTask(page, '工作一 #工作 p1')
    await addTask(page, '生活一 #生活 p4')

    // 預設為不分組
    await expect(page.getByRole('heading', { level: 2, name: '工作' })).toBeHidden()

    // 切換為「依專案分組」
    await page.getByLabel('分組方式').selectOption('project')
    await expect(page.getByRole('heading', { level: 2, name: '工作' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '生活' })).toBeVisible()

    // 切換為「依優先度分組」
    await page.getByLabel('分組方式').selectOption('priority')
    await expect(page.getByRole('heading', { level: 2, name: 'P1' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'P4' })).toBeVisible()

    // 切換回「不分組」
    await page.getByLabel('分組方式').selectOption('none')
    await expect(page.getByRole('heading', { level: 2, name: 'P1' })).toBeHidden()
  })

  test('3. 篩選列輸入 today & p1 & #工作 之類查詢，結果正確', async ({ page }) => {
    await addTask(page, '對的任務 今天 p1 #工作')
    await addTask(page, '錯的任務1 明天 p1 #工作')
    await addTask(page, '錯的任務2 今天 p2 #工作')
    await addTask(page, '錯的任務3 今天 p1 #生活')

    await page.goto('/#/filter?q=' + encodeURIComponent('today & p1 & #工作'))
    await expect(rows(page)).toHaveCount(1)
    await expect(names(page).first()).toHaveText('對的任務')
  })

  test('4. 故意打錯篩選語法，畫面明確顯示「篩選條件無法解析」，不是安靜地顯示沒有項目', async ({ page }) => {
    // 缺少右括號
    await page.goto('/#/filter?q=' + encodeURIComponent('(today & p1'))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('篩選條件無法解析')

    // 懸空的運算子
    await page.goto('/#/filter?q=' + encodeURIComponent('today &'))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('篩選條件無法解析')
  })

  test('5. 把常用篩選存成側邊欄入口，之後點擊可重新套用', async ({ page }) => {
    await addTask(page, '重要任務 p1')
    await addTask(page, '普通任務 p3')

    // 方式 A：透過管理對話框建立篩選器
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await dialog.getByLabel('篩選器名稱').fill('重要事項')
    await dialog.getByLabel('篩選條件').fill('p1')
    await dialog.getByRole('button', { name: '建立' }).last().click()
    await dialog.getByRole('button', { name: '關閉', exact: true }).click()

    // 側邊欄出現「重要事項」入口
    const sidebarLink = page.getByRole('link', { name: /^重要事項/ })
    await expect(sidebarLink).toBeVisible()

    // 點擊後跳轉並套用篩選
    await sidebarLink.click()
    expect(page.url()).toContain('#/filter?q=p1')
    await expect(rows(page)).toHaveCount(1)
    await expect(names(page).first()).toHaveText('重要任務')

    // 方式 B：在自訂篩選頁點擊「儲存此篩選器」按鈕
    await page.goto('/#/filter?q=' + encodeURIComponent('p3'))
    await expect(page.getByRole('button', { name: '儲存此篩選器' })).toBeVisible()
    await page.getByRole('button', { name: '儲存此篩選器' }).click()
    await expect(page.getByRole('link', { name: /^p3/ })).toBeVisible()
  })

  test('6. 搜尋全形／半形、大小寫混打都找得到同一筆', async ({ page }) => {
    await addTask(page, '測試 ABC １２３ 任務')

    await page.getByRole('button', { name: '搜尋代辦事項' }).click()
    const searchInput = page.locator('input[aria-label="搜尋代辦事項"]')

    // 小寫 abc 搜尋大寫 ABC
    await searchInput.fill('abc')
    await expect(rows(page)).toHaveCount(1)
    await expect(names(page).first()).toContainText('測試 ABC １２３ 任務')

    // 半形 123 搜尋全形 １２３
    await searchInput.fill('123')
    await expect(rows(page)).toHaveCount(1)
    await expect(names(page).first()).toContainText('測試 ABC １２３ 任務')

    // 全形 ａｂｃ 搜尋大寫 ABC
    await searchInput.fill('ａｂｃ')
    await expect(rows(page)).toHaveCount(1)
    await expect(names(page).first()).toContainText('測試 ABC １２３ 任務')

    // 結束搜尋
    await page.getByRole('button', { name: '結束搜尋' }).click()
    await expect(searchInput).toBeHidden()
  })

  test('7. 拖曳排序、或用每列的上移／下移按鈕', async ({ page }) => {
    for (const name of ['項目1', '項目2', '項目3']) await addTask(page, name)
    await expect(names(page)).toHaveText(['項目1', '項目2', '項目3'])

    // 上移按鈕測試
    await page.getByRole('button', { name: '將「項目3」上移' }).click()
    await expect(names(page)).toHaveText(['項目1', '項目3', '項目2'])

    // 下移按鈕測試
    await page.getByRole('button', { name: '將「項目1」下移' }).click()
    await expect(names(page)).toHaveText(['項目3', '項目1', '項目2'])

    // 邊界測試：第一列的上移與最後一列的下移按鈕應停用 (disabled)
    await expect(page.getByRole('button', { name: '將「項目3」上移' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '將「項目2」下移' })).toBeDisabled()

    // 拖曳排序 (HTML5 Drag & Drop)
    const row3 = rows(page).nth(0)
    const row2 = rows(page).nth(2)
    await row2.dragTo(row3)
    // 拖曳後順序改變
    await expect(names(page)).toHaveText(['項目2', '項目3', '項目1'])
  })
})

test.describe('批次操作與鍵盤', () => {
  test('1. Ctrl/Cmd+點擊 或按 x 多選多筆，批次改期／改優先度／移動專案／刪除', async ({ page }) => {
    // 預先建立一個目標專案
    await addTask(page, '準備專案 #目標專案')
    for (const name of ['任務A', '任務B', '任務C']) await addTask(page, name)

    // Ctrl+點擊選取任務 A 與 任務 B
    await rows(page).filter({ hasText: '任務A' }).click({ modifiers: ['ControlOrMeta'] })
    await rows(page).filter({ hasText: '任務B' }).click({ modifiers: ['ControlOrMeta'] })
    const batchBar = page.getByRole('region', { name: '批次操作' })
    await expect(batchBar).toContainText('已選 2 項')

    // 批次改期 -> 明天
    await batchBar.getByRole('button', { name: '明天' }).click()
    await expect(rows(page).filter({ hasText: '任務A' })).toContainText('明天')
    await expect(rows(page).filter({ hasText: '任務B' })).toContainText('明天')

    // 按 x 選取多筆（先用 j 移動焦點再按 x）
    await page.locator('h1').click()
    await page.keyboard.press('j')
    await page.keyboard.press('x') // 選第一筆
    await page.keyboard.press('j')
    await page.keyboard.press('x') // 選第二筆
    await expect(batchBar).toContainText('已選 2 項')

    // 批次改優先度 -> P1
    await batchBar.getByLabel('批次設定優先度').selectOption('3')
    await expect(rows(page).nth(0).getByLabel('優先度：P1')).toBeVisible()
    await expect(rows(page).nth(1).getByLabel('優先度：P1')).toBeVisible()

    // 批次移動專案 -> 目標專案
    await rows(page).nth(0).click({ modifiers: ['ControlOrMeta'] })
    await rows(page).nth(1).click({ modifiers: ['ControlOrMeta'] })
    await batchBar.getByLabel('批次移動到專案').selectOption({ label: '目標專案' })
    await expect(rows(page).nth(0)).toContainText('目標專案')
    await expect(rows(page).nth(1)).toContainText('目標專案')

    // 批次刪除
    await rows(page).nth(0).click({ modifiers: ['ControlOrMeta'] })
    await rows(page).nth(1).click({ modifiers: ['ControlOrMeta'] })
    const countBefore = await rows(page).count()
    await batchBar.getByRole('button', { name: '刪除' }).click()
    await expect(rows(page)).toHaveCount(countBefore - 2)
  })

  test('2. 批次操作只算一次復原（按一次 Ctrl/Cmd+Z 整批回到原狀）', async ({ page }) => {
    for (const name of ['甲', '乙', '丙']) await addTask(page, name)

    // 多選甲與乙，批次改期為明天
    await rows(page).nth(0).click({ modifiers: ['ControlOrMeta'] })
    await rows(page).nth(1).click({ modifiers: ['ControlOrMeta'] })
    await page.getByRole('region', { name: '批次操作' }).getByRole('button', { name: '明天' }).click()

    await expect(rows(page).nth(0)).toContainText('明天')
    await expect(rows(page).nth(1)).toContainText('明天')

    // 按一次 Ctrl+Z
    await page.keyboard.press('Control+z')

    // 兩筆同時回復，不會需要按兩次
    await expect(rows(page).nth(0)).not.toContainText('明天')
    await expect(rows(page).nth(1)).not.toContainText('明天')
  })

  test('3. j／k 上下移動焦點、e 編輯、t 排程、Enter 開詳情', async ({ page }) => {
    for (const name of ['項目一', '項目二']) await addTask(page, name)
    await page.locator('h1').click()

    // j / k 移動焦點
    await page.keyboard.press('j')
    await expect(rows(page).nth(0)).toBeFocused()
    await page.keyboard.press('j')
    await expect(rows(page).nth(1)).toBeFocused()
    await page.keyboard.press('k')
    await expect(rows(page).nth(0)).toBeFocused()

    // e 進入行內編輯
    await page.keyboard.press('e')
    const inlineInput = page.getByRole('textbox', { name: '編輯「項目一」' })
    await expect(inlineInput).toBeFocused()
    await page.keyboard.press('Escape') // 退出編輯

    // t 開啟排程選單
    await page.locator('h1').click()
    await page.keyboard.press('j')
    await page.keyboard.press('t')
    await expect(page.getByRole('menu', { name: /排程「項目一」/ })).toBeVisible()
    await page.keyboard.press('Escape') // 關閉選單

    // Enter 開啟詳情對話框
    await page.locator('h1').click()
    await page.keyboard.press('j')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByLabel('名稱', { exact: true })).toHaveValue('項目一')
    await page.keyboard.press('Escape')
  })

  test('4. Ctrl/Cmd+K 開命令面板，能找到檢視／專案／標籤／篩選器／任務', async ({ page }) => {
    await addTask(page, '買咖啡 #日常 @購物 p1')
    // 建立自訂篩選器
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const colDialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await colDialog.getByLabel('篩選器名稱').fill('重要篩選')
    await colDialog.getByLabel('篩選條件').fill('p1')
    await colDialog.getByRole('button', { name: '建立' }).last().click()
    await colDialog.getByRole('button', { name: '關閉', exact: true }).click()

    // 開啟命令面板
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: '命令面板' })
    await expect(palette).toBeVisible()
    const combobox = palette.getByRole('combobox')

    // 1. 檢視 (View)
    await combobox.fill('即將到來')
    await expect(palette.getByRole('option', { name: /前往 即將到來/ })).toBeVisible()

    // 2. 專案 (Project)
    await combobox.fill('日常')
    await expect(palette.getByRole('option', { name: /專案 日常/ })).toBeVisible()

    // 3. 標籤 (Tag)
    await combobox.fill('購物')
    await expect(palette.getByRole('option', { name: /標籤 #購物/ })).toBeVisible()

    // 4. 篩選器 (Filter)
    await combobox.fill('重要篩選')
    await expect(palette.getByRole('option', { name: /篩選器 重要篩選/ })).toBeVisible()

    // 5. 任務 (Task)
    await combobox.fill('買咖啡')
    await expect(palette.getByRole('option', { name: /任務 買咖啡/ })).toBeVisible()

    // Enter 跳轉執行
    await combobox.press('Enter')
    await expect(palette).toBeHidden()
  })

  test('5. 按 ? 開啟快捷鍵說明；在輸入框內打字時，上述按鍵不會被攔截（Esc 除外）', async ({ page }) => {
    // 1. 按 ? 開啟快捷鍵說明
    await page.locator('h1').click()
    await page.keyboard.press('?')
    const helpModal = page.getByRole('heading', { name: '鍵盤快捷鍵' })
    await expect(helpModal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(helpModal).toBeHidden()

    // 2. 在輸入框打字時，快捷鍵不被攔截（如 n, j, k, e, t, x, ?, /）
    const input = page.getByLabel('新增代辦事項')
    await input.focus()
    await page.keyboard.type('njketx?/')
    await expect(input).toHaveValue('njketx?/')
    // 確保沒有彈出快捷鍵說明或進入其他模式
    await expect(page.getByRole('heading', { name: '鍵盤快捷鍵' })).toBeHidden()

    // 3. 按 / 聚焦搜尋，在搜尋框內按 Escape 可正常關閉搜尋
    await page.locator('h1').click()
    await page.keyboard.press('/')
    const searchInput = page.locator('input[aria-label="搜尋代辦事項"]')
    await expect(searchInput).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(searchInput).toBeHidden()
  })
})
