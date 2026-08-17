import { test, expect, type Page } from '@playwright/test'

/**
 * 擴充功能的端對端驗證：任務細節、重複規則、復原、排序、快捷鍵。
 * 這些是資料模型 v2 之後才有的能力，先前的走查測試不涵蓋。
 */

async function addTask(page: Page, name: string): Promise<void> {
  await page.getByLabel('新增代辦事項').fill(name)
  await page.getByRole('button', { name: '新增' }).click()
}

const rows = (page: Page) => page.locator('main li')
const names = (page: Page) => page.locator('main li p')

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/')
})

test.describe('任務細節', () => {
  test('可設定優先度與到期日，並顯示為標記', async ({ page }) => {
    await addTask(page, '要設細節的')
    await page.getByRole('button', { name: /設定「要設細節的」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('優先度').selectOption('3')
    await dialog.getByLabel('到期日').fill('2030-01-15')
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(dialog).not.toBeVisible()
    await expect(rows(page).first().getByLabel('優先度：高')).toBeVisible()
    await expect(rows(page).first()).toContainText('2030-01-15')
  })

  test('取消不會寫入變更', async ({ page }) => {
    await addTask(page, '不要改我')
    await page.getByRole('button', { name: /設定「不要改我」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('名稱', { exact: true }).fill('被改掉了')
    await dialog.getByRole('button', { name: '取消' }).click()

    await expect(names(page).first()).toHaveText('不要改我')
  })

  test('沒有到期日時時間欄位停用', async ({ page }) => {
    await addTask(page, '時間依附於日期')
    await page.getByRole('button', { name: /設定「時間依附於日期」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('時間')).toBeDisabled()
    await dialog.getByLabel('到期日').fill('2030-03-01')
    await expect(dialog.getByLabel('時間')).toBeEnabled()
  })

  test('可就地建立專案與標籤並直接套用', async ({ page }) => {
    await addTask(page, '要分類的')
    await page.getByRole('button', { name: /設定「要分類的」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('新專案名稱').fill('工作')
    await dialog.getByRole('button', { name: '建立' }).first().click()
    await dialog.getByLabel('新標籤名稱').fill('緊急')
    await dialog.getByRole('button', { name: '建立' }).last().click()
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(rows(page).first()).toContainText('工作')
    await expect(rows(page).first()).toContainText('#緊急')
  })

  test('對話框以原生 dialog 提供 Escape 關閉', async ({ page }) => {
    await addTask(page, '用 Esc 關掉')
    await page.getByRole('button', { name: /設定「用 Esc 關掉」的細節/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})

test.describe('重複性任務', () => {
  test('完成時推進到下一次而非消失', async ({ page }) => {
    await addTask(page, '每天要做的')
    await page.getByRole('button', { name: /設定「每天要做的」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('到期日').fill('2030-01-01')
    await dialog.getByLabel('啟用重複').check()
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(rows(page).first()).toContainText('每天')
    await expect(rows(page).first()).toContainText('2030-01-01')

    // 勾選完成 -> 到期日推進，任務仍在未完成清單
    await rows(page).first().locator('input[type=checkbox]').check()
    await expect(rows(page).first()).toContainText('2030-01-02')
    await expect(page.getByText('未完成: 1 項')).toBeVisible()
  })
})

test.describe('復原', () => {
  test('刪除後可復原，且不再跳確認對話框', async ({ page }) => {
    await addTask(page, '刪了還能救')
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.getByRole('button', { name: '復原' }).click()
    await expect(names(page).first()).toHaveText('刪了還能救')
  })

  test('清除已完成後可復原', async ({ page }) => {
    await addTask(page, '會被清掉')
    await rows(page).first().locator('input[type=checkbox]').check()
    await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.getByRole('button', { name: '復原' }).click()
    await expect(rows(page)).toHaveCount(1)
  })

  test('Ctrl+Z 也能復原', async ({ page }) => {
    await addTask(page, '用快捷鍵救回來')
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect(rows(page)).toHaveCount(1)
  })
})

test.describe('排序', () => {
  test('上移／下移按鈕可調整順序，鍵盤使用者不需要拖曳', async ({ page }) => {
    for (const name of ['第一', '第二', '第三']) await addTask(page, name)
    await expect(names(page)).toHaveText(['第一', '第二', '第三'])

    await page.getByRole('button', { name: '將「第三」上移' }).click()
    await expect(names(page)).toHaveText(['第一', '第三', '第二'])

    await page.getByRole('button', { name: '將「第一」下移' }).click()
    await expect(names(page)).toHaveText(['第三', '第一', '第二'])
  })

  test('第一列不能上移，最後一列不能下移', async ({ page }) => {
    for (const name of ['甲', '乙']) await addTask(page, name)

    await expect(page.getByRole('button', { name: '將「甲」上移' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '將「乙」下移' })).toBeDisabled()
  })

  test('順序在重新整理後保留', async ({ page }) => {
    for (const name of ['A', 'B']) await addTask(page, name)
    await page.getByRole('button', { name: '將「B」上移' }).click()
    await expect(names(page)).toHaveText(['B', 'A'])

    await page.reload()
    await expect(names(page)).toHaveText(['B', 'A'])
  })
})

test.describe('快捷鍵', () => {
  test('n 聚焦新增欄位，/ 聚焦搜尋', async ({ page }) => {
    await page.keyboard.press('n')
    await expect(page.getByLabel('新增代辦事項')).toBeFocused()

    // 聚焦在輸入框時不該攔截按鍵，否則沒辦法正常打字
    await page.keyboard.type('nnn')
    await expect(page.getByLabel('新增代辦事項')).toHaveValue('nnn')

    await page.keyboard.press('Escape')
    await page.locator('h1').click()
    await page.keyboard.press('/')
    await expect(page.getByLabel('搜尋代辦事項')).toBeFocused()
  })
})

test.describe('空狀態', () => {
  test('依情境給出不同的空狀態說明', async ({ page }) => {
    await expect(page.getByText('目前沒有代辦事項，從上方新增一筆吧')).toBeVisible()

    await addTask(page, '存在的項目')
    await page.getByRole('link', { name: /^完成/ }).click()
    await expect(page.getByText('還沒有已完成的代辦事項')).toBeVisible()

    await page.getByRole('link', { name: /^全部/ }).click()
    await page.getByRole('button', { name: '搜尋代辦事項' }).click()
    await page.getByLabel('搜尋代辦事項').fill('找不到的東西')
    await expect(page.getByText('找不到符合「找不到的東西」的代辦事項')).toBeVisible()
  })
})
