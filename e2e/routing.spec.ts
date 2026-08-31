import { test, expect } from '@playwright/test'

/**
 * 篩選狀態改由網址承載後的行為驗證。
 * 這是原本存在 store 裡的 pages 數字做不到的：可深連結、可分享、
 * 上一頁/下一頁符合直覺，也不會再持久化一個超出範圍的數字（稽核 P3）。
 */

/** 對話框只能有一個處理器，統一在這裡接住並記錄，供各測試檢查。 */
let alerts: string[] = []

test.beforeEach(async ({ page }) => {
  alerts = []
  page.on('dialog', (d) => {
    alerts.push(d.message())
    void d.accept()
  })
  await page.goto('/#/all')
  for (const [name, done] of [
    ['未完成的事', false],
    ['已完成的事', true],
  ] as const) {
    await page.getByLabel('新增代辦事項').fill(name)
    await page.getByRole('button', { name: '新增' }).click()
    if (done) {
      await page.locator('main li').last().locator('input[type=checkbox]').check()
    }
  }
  // 同步點：確認狀態已反映在畫面上，避免導覽搶在非同步寫入之前
  await expect(page.getByText('已完成: 1 項')).toBeVisible()
})

test('每個檢視各自對應一個網址', async ({ page }) => {
  await page.getByRole('link', { name: /^未完成/ }).click()
  expect(page.url()).toContain('#/active')
  await expect(page.locator('main li')).toHaveCount(1)
  await expect(page.locator('main li p', { hasText: '未完成的事' })).toBeVisible()

  await page.getByRole('link', { name: /^已完成/ }).click()
  expect(page.url()).toContain('#/completed')
  await expect(page.locator('main li p', { hasText: '已完成的事' })).toBeVisible()

  await page.getByRole('link', { name: /^全部/ }).click()
  expect(page.url()).toContain('#/all')
  await expect(page.locator('main li')).toHaveCount(2)
})

test('預設落地在「今天」，而不是「全部」', async ({ page }) => {
  await page.goto('/')
  // 轉址是掛載之後才發生的，先等畫面到位再看網址
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今天')
  expect(page.url()).toContain('#/today')
})

test('專案有自己的網址，可深連結', async ({ page }) => {
  await page.getByRole('button', { name: '管理專案與標籤' }).click()
  await page.getByLabel('新專案名稱').fill('工作')
  await page.getByRole('button', { name: '建立' }).first().click()
  // 「關閉」要精確比對：footer 的「關閉提示」也含這兩個字
  await page.getByRole('button', { name: '關閉', exact: true }).click()

  await page.getByRole('link', { name: /^工作/ }).click()
  expect(page.url()).toContain('#/project/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('工作')

  const url = page.url()
  await page.reload()
  expect(page.url()).toBe(url)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('工作')
})

test('深連結可直接開啟，重新整理後仍在同一個分頁', async ({ page }) => {
  await page.goto('/#/completed')
  await expect(page.locator('main li p', { hasText: '已完成的事' })).toBeVisible()
  await expect(page.locator('main li')).toHaveCount(1)

  await page.reload()
  expect(page.url()).toContain('#/completed')
  await expect(page.locator('main li')).toHaveCount(1)
})

test('瀏覽器上一頁 / 下一頁可在分頁之間往返', async ({ page }) => {
  await page.getByRole('link', { name: /^未完成/ }).click()
  await page.getByRole('link', { name: /^已完成/ }).click()
  expect(page.url()).toContain('#/completed')

  await page.goBack()
  expect(page.url()).toContain('#/active')
  await expect(page.locator('main li p', { hasText: '未完成的事' })).toBeVisible()

  await page.goForward()
  expect(page.url()).toContain('#/completed')
  await expect(page.locator('main li p', { hasText: '已完成的事' })).toBeVisible()
})

test('未知路徑導回今天，不留空白畫面', async ({ page }) => {
  await page.goto('/#/does-not-exist')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今天')
  expect(page.url()).toContain('#/today')
})

test('目前檢視以 aria-current 標示，不只靠顏色（稽核 P5/P6）', async ({ page }) => {
  await page.goto('/#/active')
  const links = page.getByRole('link')
  await expect(links.filter({ hasText: /^未完成/ })).toHaveAttribute('aria-current', 'page')
  await expect(links.filter({ hasText: /^全部/ })).not.toHaveAttribute('aria-current', 'page')
})

test('檢視連結可用鍵盤操作（稽核 P6 已修正）', async ({ page }) => {
  await page.goto('/#/all')
  const activeLink = page.getByRole('link', { name: /^未完成/ })
  await activeLink.focus()
  await expect(activeLink).toBeFocused()
  await page.keyboard.press('Enter')

  expect(page.url()).toContain('#/active')
  await expect(page.locator('main li')).toHaveCount(1)
})

test('空清單時仍可切換到任一分頁，不再被 alert 攔截', async ({ page }) => {
  await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
  await page.locator('main li').first().getByRole('button', { name: '刪除' }).click()
  await expect(page.locator('main li')).toHaveCount(0)

  await page.getByRole('link', { name: /^已完成/ }).click()
  expect(page.url()).toContain('#/completed')
  await expect(page.locator('h1'), '空清單也應正常渲染').toBeVisible()

  const blocked = alerts.filter((a) => a.includes('暫無'))
  expect(blocked, '導覽不該被阻塞式對話框攔下').toEqual([])
})
