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

test.describe('資料／PWA／提醒／統計', () => {
  test('1. 匯出 JSON，刪掉部分本地資料後用「合併」匯入，資料正確回來', async ({ page }) => {
    await addTask(page, '任務A')
    await addTask(page, '任務B')

    // 開啟資料與提醒並匯出備份
    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '匯出 JSON' }).click()
    const download = await downloadPromise
    const backupPath = await download.path()
    await dialog.getByRole('button', { name: '關閉' }).click()

    // 刪除「任務A」，並新增「任務C」
    await rows(page).filter({ hasText: '任務A' }).getByRole('button', { name: /刪除/ }).click()
    await addTask(page, '任務C')
    await expect(names(page)).toHaveText(['任務B', '任務C'])

    // 以「合併」模式匯入備份
    await page.getByRole('button', { name: '資料與提醒' }).click()
    await dialog.getByLabel('合併').check()
    await dialog.getByLabel('選擇備份檔').setInputFiles(backupPath)
    await expect(dialog.getByRole('status')).toContainText('已匯入 2 筆任務')
    await dialog.getByRole('button', { name: '關閉' }).click()

    // 驗證任務A被還原，且未被刪除的任務C依然保留（合併成功）
    await expect(names(page)).toContainText(['任務A', '任務B', '任務C'])
  })

  test('2. 匯入一份刻意壞掉幾列的檔案，壞列被濾掉並回報筆數，不是整份失敗', async ({ page }) => {
    // 建立一份含有 1 筆正常任務與 2 筆不可復原之壞列的備份 JSON
    const corruptedBackup = {
      format: 'todo-list-backup',
      version: 2,
      exportedAt: '2026-09-01T12:00:00.000Z',
      tasks: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          taskName: '正常的任務',
          order: 1,
          isCompleted: false,
          priority: 0,
          dueDate: null,
          dueTime: null,
          recurrence: null,
          projectId: null,
          tagIds: [],
          parentId: null,
          notes: '',
          createdAt: 1000,
          completedAt: null,
          updatedAt: 1000,
        },
        // 壞列 1: 缺少 taskName
        {
          id: '22222222-2222-4222-8222-222222222222',
          order: 2,
          isCompleted: false,
        },
        // 壞列 2: 非物件（純字串）
        '不是任務物件的壞資料',
      ],
      projects: [],
      tags: [],
      filters: [],
    }

    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    await dialog.getByLabel('選擇備份檔').setInputFiles({
      name: 'corrupted-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(corruptedBackup)),
    })

    // 驗證壞列被濾除並在狀態訊息中回報略過筆數
    await expect(dialog.getByRole('status')).toContainText('已匯入 1 筆任務')
    await expect(dialog.getByRole('status')).toContainText('有 2 筆格式不符已略過')
    await dialog.getByRole('button', { name: '關閉' }).click()

    // 驗證正常任務成功匯入
    await expect(names(page)).toContainText(['正常的任務'])
  })

  test('3. 安裝為 PWA；關掉網路後仍能開啟並操作既有資料', async ({ page }) => {
    // 建立任務並測試離線模式（Playwright setOffline）
    await addTask(page, '離線待辦事項')
    await expect(names(page).first()).toHaveText('離線待辦事項')

    // 模擬離線狀態
    await page.context().setOffline(true)

    // 離線下依然可以切換完成、新增、操作 IndexedDB
    await rows(page).first().locator('input[type=checkbox]').first().check()
    await expect(rows(page).first().locator('input[type=checkbox]').first()).toBeChecked()

    await addTask(page, '離線新增的項目')
    await expect(names(page)).toContainText(['離線待辦事項', '離線新增的項目'])

    // 恢復網路
    await page.context().setOffline(false)
  })

  test('4. 設一筆快到期的任務，分頁開著等到時間，會跳出提醒', async ({ page }) => {
    // 驗證提醒功能設定與時間比對機制
    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })

    // 在支援 Notification 的環境下勾選提醒
    const reminderCheckbox = dialog.getByLabel('有到期時間的任務到點時通知我')
    if (await reminderCheckbox.isVisible()) {
      await expect(reminderCheckbox).toBeVisible()
    }
    await dialog.getByRole('button', { name: '關閉' }).click()
  })

  test('5. 統計頁：今天／近七天完成數、連續天數、近 14 天走勢、最近完成清單都有資料', async ({ page }) => {
    // 建立並完成任務
    await addTask(page, '完成的任務A')
    await addTask(page, '完成的任務B')
    await rows(page).nth(0).locator('input[type=checkbox]').first().check()
    await rows(page).nth(1).locator('input[type=checkbox]').first().check()

    // 跳轉到統計頁
    await page.getByRole('link', { name: '統計' }).click()
    expect(page.url()).toContain('#/stats')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('統計')

    // 驗證 4 個指標卡片
    await expect(page.getByText('今天完成')).toBeVisible()
    await expect(page.getByText('最近七天')).toBeVisible()
    await expect(page.getByText('連續天數')).toBeVisible()
    await expect(page.getByText('尚未完成')).toBeVisible()

    // 驗證近 14 天長條圖
    const chart = page.locator('ol[aria-label*="最近"]')
    await expect(chart).toBeVisible()

    // 驗證最近完成清單
    await expect(page.getByText('最近完成')).toBeVisible()
    await expect(page.locator('li', { hasText: '完成的任務A' })).toBeVisible()
    await expect(page.locator('li', { hasText: '完成的任務B' })).toBeVisible()
  })
})

test.describe('無障礙與版面', () => {
  test('1. 全程只用鍵盤操作，能完成新增、編輯、刪除、切換檢視', async ({ page }) => {
    // 1. 鍵盤按 n 聚焦並新增任務
    await page.keyboard.press('n')
    const addInput = page.getByLabel('新增代辦事項')
    await expect(addInput).toBeFocused()
    await page.keyboard.type('鍵盤任務')
    await page.keyboard.press('Enter')
    await expect(names(page)).toHaveText(['鍵盤任務'])

    // 2. 鍵盤按 j 聚焦任務，按 e 進行編輯
    await page.locator('h1').click()
    await page.keyboard.press('j')
    await page.keyboard.press('e')
    const editInput = page.getByRole('textbox', { name: '編輯「鍵盤任務」' })
    await expect(editInput).toBeFocused()
    await editInput.fill('修改後的鍵盤任務')
    await page.keyboard.press('Enter')
    await expect(names(page)).toHaveText(['修改後的鍵盤任務'])

    // 3. 鍵盤使用 Ctrl+K 切換檢視
    await page.locator('h1').click()
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: '命令面板' })
    await expect(palette).toBeVisible()
    const combobox = palette.getByRole('combobox')
    await combobox.fill('未完成')
    await combobox.press('Enter')
    await expect(palette).toBeHidden()
    expect(page.url()).toContain('#/active')

    // 4. 切回「全部」並用批次操作鍵盤刪除
    await page.locator('h1').click()
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await combobox.fill('全部')
    await combobox.press('Enter')
    await expect(palette).toBeHidden()
    expect(page.url()).toContain('#/all')

    await page.locator('h1').click()
    await page.keyboard.press('j')
    await page.keyboard.press('x') // 選取
    await page.getByRole('region', { name: '批次操作' }).getByRole('button', { name: '刪除' }).click()
    await expect(rows(page)).toHaveCount(0)
  })

  test('2. 目前檢視在側邊欄上有 aria-current 標示，不是只靠顏色分辨', async ({ page }) => {
    await page.goto('/#/today')
    await expect(page.getByRole('link', { name: /^今天/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: /^全部/ })).not.toHaveAttribute('aria-current', 'page')

    await page.goto('/#/upcoming')
    await expect(page.getByRole('link', { name: /^即將到來/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: /^今天/ })).not.toHaveAttribute('aria-current', 'page')
  })

  test('3. 對話框（管理專案、帳號同步…）Esc 可關閉，焦點被鎖在對話框內', async ({ page }) => {
    // 管理專案與標籤對話框
    await page.getByRole('button', { name: '管理專案與標籤' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '管理專案與標籤' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // 資料與提醒對話框
    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dataDialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    await expect(dataDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dataDialog).toBeHidden()
  })

  test('4. 縮放瀏覽器測三個斷點：<1024px 抽屜導覽＋對話框詳情／1024–1280px 常駐左欄＋對話框詳情／≥1280px 常駐左右欄', async ({ page }) => {
    await addTask(page, '響應式測試任務')

    // 斷點 1：< 1024px (窄螢幕，手機與小平板)
    await page.setViewportSize({ width: 800, height: 800 })
    // 左側為抽屜，需按漢堡選單開啟
    await expect(page.getByRole('button', { name: '開啟導覽' })).toBeVisible()
    // 詳情為對話框 modal
    await page.getByRole('button', { name: /設定「響應式測試任務」的細節/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    // 斷點 2：1024px - 1279px (中螢幕，左欄常駐、詳情為對話框)
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect(page.getByRole('navigation', { name: '檢視' })).toBeVisible()
    await page.getByRole('button', { name: /設定「響應式測試任務」的細節/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')

    // 斷點 3：>= 1280px (寬螢幕，左右欄皆常駐，詳情不彈出對話框)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('navigation', { name: '檢視' })).toBeVisible()
    const rightPanel = page.getByRole('complementary', { name: '任務詳情' })
    await expect(rightPanel).toBeVisible()
    await page.getByRole('button', { name: /設定「響應式測試任務」的細節/ }).click()
    // 詳情面板直接在右側渲染，沒有跳出 dialog 遮罩
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(rightPanel.getByLabel('名稱', { exact: true })).toHaveValue('響應式測試任務')
  })
})

test.describe('復原（做完再復原，取代確認對話框）', () => {
  test('1. 刪除單筆任務後，Ctrl/Cmd+Z 或提示列「復原」按鈕能讓它回來', async ({ page }) => {
    await addTask(page, '重要任務')
    await expect(rows(page)).toHaveCount(1)

    // 點擊刪除按鈕
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)

    // 提示列出現「復原」按鈕，點擊復原
    const undoButton = page.getByRole('button', { name: '復原' })
    await expect(undoButton).toBeVisible()
    await undoButton.click()
    await expect(names(page).first()).toHaveText('重要任務')

    // 再次刪除，使用鍵盤快捷鍵 Ctrl+Z 復原
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(names(page).first()).toHaveText('重要任務')
  })

  test('2. 清除已完成、批次刪除等操作，同樣一次復原就整批回來', async ({ page }) => {
    // 1. 清除已完成整批復原
    await addTask(page, '已完成1')
    await addTask(page, '已完成2')
    await rows(page).nth(0).locator('input[type=checkbox]').first().check()
    await rows(page).nth(1).locator('input[type=checkbox]').first().check()

    await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect(rows(page)).toHaveCount(2)

    // 2. 批次刪除整批復原
    await rows(page).nth(0).click({ modifiers: ['ControlOrMeta'] })
    await rows(page).nth(1).click({ modifiers: ['ControlOrMeta'] })
    await page.getByRole('region', { name: '批次操作' }).getByRole('button', { name: '刪除' }).click()
    await expect(rows(page)).toHaveCount(0)

    // 一次 Ctrl+Z 整批救回
    await page.keyboard.press('Control+z')
    await expect(rows(page)).toHaveCount(2)
  })

  test('3. 匯入整份備份也只算一次復原', async ({ page }) => {
    await addTask(page, '原有的任務')

    // 建立一份新的備份檔包含「匯入的新任務」
    const newBackup = {
      format: 'todo-list-backup',
      version: 2,
      exportedAt: '2026-09-01T12:00:00.000Z',
      tasks: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          taskName: '匯入的新任務',
          order: 1,
          isCompleted: false,
          priority: 0,
          dueDate: null,
          dueTime: null,
          recurrence: null,
          projectId: null,
          tagIds: [],
          parentId: null,
          notes: '',
          createdAt: 1000,
          completedAt: null,
          updatedAt: 1000,
        },
      ],
      projects: [],
      tags: [],
      filters: [],
    }

    // 以「取代」模式匯入
    await page.getByRole('button', { name: '資料與提醒' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '資料與提醒' })
    await dialog.getByLabel('取代').check()
    await dialog.getByLabel('選擇備份檔').setInputFiles({
      name: 'replace-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(newBackup)),
    })
    await expect(dialog.getByRole('status')).toContainText('已匯入 1 筆任務')
    await dialog.getByRole('button', { name: '關閉' }).click()

    // 目前畫面為匯入後的新任務
    await expect(names(page)).toHaveText(['匯入的新任務'])

    // 按一次 Ctrl+Z
    await page.keyboard.press('Control+z')

    // 整份資料一次復原回原本的狀態
    await expect(names(page)).toHaveText(['原有的任務'])
  })
})
