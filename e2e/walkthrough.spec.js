import { test, expect } from '@playwright/test'

/**
 * 稽核報告 U3：Demo 的實際互動走查。
 * 同時在真實瀏覽器中重現 P1 與 P2，作為 Phase 1 修正前的基準證據。
 */

// 每個 test 都有獨立的 browser context，localStorage 本來就是乾淨的。
// 不要用 addInitScript 清除 —— 它在每次 navigation 都會執行，reload 時會把資料一併清掉。
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
})

test('U3: 增刪改查完整走查', async ({ page }) => {
  await page.goto('/')

  // 新增
  await page.getByPlaceholder('請輸入代辦事項').fill('買牛奶')
  await page.getByRole('button', { name: '+' }).click()
  await page.getByPlaceholder('請輸入代辦事項').fill('寫報告')
  await page.getByRole('button', { name: '+' }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(2)
  await expect(page.getByText('全部: 2 項')).toBeVisible()

  // 完成
  await page.locator('div.bg-gray-300').first().locator('input[type=checkbox]').check()
  await expect(page.getByText('已完成: 1 項')).toBeVisible()
  await expect(page.locator('div.bg-gray-300').first().locator('p')).toHaveClass(/line-through/)

  // 編輯
  await page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '編輯' }).click()
  await page.getByPlaceholder('請輸入編輯內容').fill('寫稽核報告')
  await page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('寫稽核報告')).toBeVisible()

  // 分頁
  await page.getByText('未完成', { exact: true }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(1)
  await page.getByText('完成', { exact: true }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(1)
  await page.getByText('全部', { exact: true }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(2)

  // 搜尋
  await page.getByRole('button', { name: '搜尋模式🔍' }).click()
  await page.getByPlaceholder('請輸入關鍵字').fill('牛奶')
  await expect(page.locator('div.bg-gray-300')).toHaveCount(1)
  await page.getByRole('button', { name: '回列表模式📋' }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(2)

  // 清除已完成
  await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(1)

  // 刪除
  await page.locator('div.bg-gray-300').first().getByRole('button', { name: '刪除' }).click()
  await expect(page.locator('div.bg-gray-300')).toHaveCount(0)
})

test('U3b: 重新整理後資料仍在（持久化生效）', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('請輸入代辦事項').fill('持久化測試')
  await page.getByRole('button', { name: '+' }).click()

  await page.reload()
  await expect(page.getByText('持久化測試')).toBeVisible()
})

test('P1 基準：編輯中重新整理會清空輸入框並鎖住清單', async ({ page }) => {
  await page.goto('/')
  for (const t of ['原本的內容', '另一筆']) {
    await page.getByPlaceholder('請輸入代辦事項').fill(t)
    await page.getByRole('button', { name: '+' }).click()
  }

  await page.locator('div.bg-gray-300').first().getByRole('button', { name: '編輯' }).click()
  await expect(page.getByPlaceholder('請輸入編輯內容')).toHaveValue('原本的內容')

  await page.reload()

  // 稽核 P1：isEdit 被持久化，但編輯暫存值不是
  const editBox = page.getByPlaceholder('請輸入編輯內容')
  await expect(editBox).toBeVisible()
  await expect(editBox, 'P1：重新整理後編輯框是空的，原文字看不見了').toHaveValue('')
  await expect(page.getByText('原本的內容')).toHaveCount(0)

  // 保存被擋下，仍在編輯狀態
  await page.locator('div.bg-gray-300').first().getByRole('button', { name: '保存' }).click()
  await expect(page.getByPlaceholder('請輸入編輯內容'), 'P1：無法離開編輯狀態').toBeVisible()

  // 另一筆也不能編輯，整份清單卡住
  await expect(
    page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '編輯' }),
  ).toBeVisible()
  await page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '編輯' }).click()
  await expect(
    page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '保存' }),
    'P1：其他項目也被守衛擋下',
  ).toHaveCount(0)
})

/**
 * P2 調查：在真實瀏覽器的完整流程下，各種壞資料實際會發生什麼事。
 * 稽核報告的 P2 是用 node 層直接呼叫 $patch 重現的；這裡驗證真實路徑。
 */
// 第三欄 = 目前（Phase 1 修正前）的實測行為基準。
// Phase 1 修好之後，broken 的那幾條會轉紅 —— 那正是修正生效的證明。
const BAD_PAYLOADS = [
  ['todoList 為 null', '{"todoList":null}', 'broken', 0],
  ['todoList 為字串', '{"todoList":"oops"}', 'broken', 4],
  ['todoList 為數字', '{"todoList":42}', 'broken', 42],
  ['todoList 為物件', '{"todoList":{"a":1}}', 'broken', 1],
  ['項目為 null', '{"todoList":[null]}', 'broken', 0],
  ['項目缺 taskName', '{"todoList":[{"id":1,"isCompleted":false}]}', 'ok', 1],
  ['taskName 為數字', '{"todoList":[{"id":1,"taskName":123,"isCompleted":false}]}', 'ok', 1],
  ['pages 超出範圍', '{"todoList":[{"id":1,"taskName":"a","isCompleted":false}],"pages":7}', 'ok', 0],
  ['整份不是物件', '"just a string"', 'ok', 0],
  ['JSON 語法錯誤', '{todoList: [}', 'ok', 0],
]

for (const [label, payload, baseline, expectedRows] of BAD_PAYLOADS) {
  test(`P2 基準：${label} → ${baseline === 'broken' ? '部分渲染失敗' : '正常渲染'}`, async ({ page }) => {
    const uncaught = []
    const consoleErrors = []
    page.on('pageerror', (e) => uncaught.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.addInitScript((p) => {
      window.localStorage.setItem('todoTask', p)
    }, payload)
    await page.goto('/')
    await page.waitForTimeout(300)

    const state = await page.evaluate(() => ({
      appLen: document.querySelector('#app').innerHTML.length,
      hasHeader: !!document.querySelector('h1'),
      hasTabs: document.querySelectorAll('div.w-20').length,
      hasFooter: !!document.querySelector('button.bg-blue-800'),
      rows: document.querySelectorAll('div.bg-gray-300').length,
    }))

    const parts = [
      state.hasHeader ? 'Header✓' : 'Header✗',
      state.hasTabs === 3 ? 'Tabs✓' : `Tabs✗(${state.hasTabs})`,
      state.hasFooter ? 'Footer✓' : 'Footer✗',
      `列數=${state.rows}`,
    ].join(' ')

    const verdict = state.appLen === 0 ? '完全白畫面' : state.hasFooter ? '完整渲染' : '部分渲染失敗'
    console.log(
      `  P2 [${label.padEnd(16)}] ${verdict.padEnd(12)} ${parts}` +
        `  console: ${consoleErrors.length ? consoleErrors[0].slice(0, 45) : '無'}`,
    )

    // 實測結論：Vue 會攔截 render 錯誤並記到 console，不會產生未捕捉例外，
    // 因此使用者看到的是「元件消失」而非瀏覽器報錯。
    expect(uncaught, '不會產生未捕捉的例外').toEqual([])

    if (baseline === 'broken') {
      // 新增輸入框所在的 header 與統計所在的 footer 整區消失 —— App 實質不可用
      expect(state.hasHeader, `${label}：header 應消失（現況缺陷）`).toBe(false)
      expect(state.hasFooter, `${label}：footer 應消失（現況缺陷）`).toBe(false)
      expect(consoleErrors.join('\n')).toMatch(/TypeError/)
      // 非陣列的 todoList 被 v-for 硬走訪，產生垃圾列
      expect(state.rows, `${label}：列數`).toBe(expectedRows)
    } else {
      expect(state.hasHeader, `${label}：header 正常`).toBe(true)
      expect(state.hasFooter, `${label}：footer 正常`).toBe(true)
      expect(consoleErrors, `${label}：無 console 錯誤`).toEqual([])
      expect(state.rows, `${label}：列數`).toBe(expectedRows)
    }
  })
}
