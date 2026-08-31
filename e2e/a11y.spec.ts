import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * 自動化無障礙檢測。
 *
 * 稽核報告的 P5（對比度）、P6（分頁不可鍵盤操作）、P7（checkbox 無可及名稱）
 * 都是人工發現的。把 axe 接進 CI 之後，同類問題會在提交當下就被擋下，
 * 不必等下一次人工稽核。
 *
 * 值得記錄的交叉驗證：axe 實測到的對比度與稽核報告手算的結果一致
 * （yellow-400 1.53、green-500 2.27、blue-500 3.67、red-500 3.76），
 * 兩種獨立方法得到同樣的數字。
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const SCREENS = [
  { name: '今天', path: '/#/today' },
  { name: '即將到來', path: '/#/upcoming' },
  { name: '收件匣', path: '/#/inbox' },
  { name: '全部', path: '/#/all' },
  { name: '未完成', path: '/#/active' },
  { name: '已完成', path: '/#/completed' },
]

async function seed(page: Page) {
  page.on('dialog', (d) => d.accept())
  // 從「全部」開始 seed：在「今天」新增會自動帶上今天的到期日，
  // 那是刻意的行為，但會讓這裡的固定情境變得依賴當天日期。
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
  await expect(page.getByText('全部: 2 項')).toBeVisible()
}

/** 跑一次 axe 並把違規整理成可讀的列表。 */
async function violationsOf(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.flatMap((v) =>
    v.nodes.map(
      (n) =>
        `[${v.impact}] ${v.id} @ ${String(n.target[0])} — ` +
        (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 120),
    ),
  )
}

for (const screen of SCREENS) {
  test(`${screen.name} 畫面：WCAG 2.1 AA 零違規（含對比度）`, async ({ page }) => {
    await seed(page)
    await page.goto(screen.path)
    await page.waitForSelector('h1')

    const found = await violationsOf(page)
    if (found.length) {
      console.log(`\n  ${screen.name} 違規 ${found.length} 項：`)
      for (const f of found) console.log('    ' + f)
    }
    expect(found).toEqual([])
  })
}

test('編輯狀態下也維持零違規', async ({ page }) => {
  await seed(page)
  await page.locator('main li').first().getByRole('button', { name: '編輯' }).click()

  const found = await violationsOf(page)
  if (found.length) for (const f of found) console.log('    ' + f)
  expect(found).toEqual([])
})

test('搜尋模式下也維持零違規', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: '搜尋代辦事項' }).click()

  const found = await violationsOf(page)
  if (found.length) for (const f of found) console.log('    ' + f)
  expect(found).toEqual([])
})

test('管理專案與標籤的對話框也維持零違規', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: '管理專案與標籤' }).click()
  await page.getByLabel('新專案名稱').fill('工作')
  await page.getByRole('button', { name: '建立' }).first().click()

  const found = await violationsOf(page)
  if (found.length) for (const f of found) console.log('    ' + f)
  expect(found).toEqual([])
})

test('窄螢幕的導覽抽屜也維持零違規', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.getByRole('button', { name: '開啟導覽' }).click()
  await expect(page.getByRole('navigation', { name: '檢視' })).toBeVisible()

  const found = await violationsOf(page)
  if (found.length) for (const f of found) console.log('    ' + f)
  expect(found).toEqual([])
})

test('空清單狀態也維持零違規', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
  await page.waitForSelector('h1')

  const found = await violationsOf(page)
  if (found.length) for (const f of found) console.log('    ' + f)
  expect(found).toEqual([])
})
