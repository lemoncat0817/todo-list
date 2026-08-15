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

test('P1 已修正：編輯中重新整理會回到閱讀狀態，原文字完好', async ({ page }) => {
  await page.goto('/')
  for (const t of ['原本的內容', '另一筆']) {
    await page.getByPlaceholder('請輸入代辦事項').fill(t)
    await page.getByRole('button', { name: '+' }).click()
  }

  await page.locator('div.bg-gray-300').first().getByRole('button', { name: '編輯' }).click()
  await expect(page.getByPlaceholder('請輸入編輯內容')).toHaveValue('原本的內容')

  await page.reload()

  // 編輯狀態不再被持久化：重新整理後回到閱讀狀態
  await expect(page.getByPlaceholder('請輸入編輯內容'), '不應殘留編輯框').toHaveCount(0)
  await expect(page.getByText('原本的內容'), '原文字完好').toBeVisible()

  // 兩筆都能正常進入編輯，清單沒有被鎖住
  await page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '編輯' }).click()
  await expect(page.getByPlaceholder('請輸入編輯內容')).toHaveValue('另一筆')
  await page.getByPlaceholder('請輸入編輯內容').fill('改過的內容')
  await page.locator('div.bg-gray-300').nth(1).getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('改過的內容')).toBeVisible()
})

test('升級路徑：既有使用者的舊格式資料（含 isEdit）仍可正常讀取', async ({ page }) => {
  // 舊版寫入的形狀，其中一筆正卡在 isEdit:true —— 也就是 P1 的受害狀態
  await page.addInitScript(() => {
    localStorage.setItem(
      'todoTask',
      JSON.stringify({
        todoList: [
          { id: 1, taskName: '舊資料一', isCompleted: false, isEdit: true },
          { id: 2, taskName: '舊資料二', isCompleted: true, isEdit: false },
        ],
        pages: 0,
        isSearch: false,
        keyword: '',
      }),
    )
  })
  await page.goto('/')

  // 兩筆都在，且都以閱讀狀態呈現 —— 卡住的編輯狀態被自動解除
  await expect(page.getByText('舊資料一')).toBeVisible()
  await expect(page.getByText('舊資料二')).toBeVisible()
  await expect(page.getByPlaceholder('請輸入編輯內容')).toHaveCount(0)
  await expect(page.getByText('全部: 2 項')).toBeVisible()
  await expect(page.getByText('已完成: 1 項')).toBeVisible()

  // 後續寫回的資料已是新形狀
  await page.getByPlaceholder('請輸入代辦事項').fill('新增一筆')
  await page.getByRole('button', { name: '+' }).click()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('todoTask')))
  expect(stored.todoList.some((t) => 'isEdit' in t), '舊的 isEdit 欄位應已消失').toBe(false)
})

test('P1 已修正：isEdit 不再被寫進 localStorage', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('請輸入代辦事項').fill('檢查持久化形狀')
  await page.getByRole('button', { name: '+' }).click()
  await page.locator('div.bg-gray-300').first().getByRole('button', { name: '編輯' }).click()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('todoTask')))
  expect(stored.todoList[0]).not.toHaveProperty('isEdit')
  expect(Object.keys(stored.todoList[0]).sort()).toEqual(['id', 'isCompleted', 'taskName'])
})

/**
 * P2 調查：在真實瀏覽器的完整流程下，各種壞資料實際會發生什麼事。
 * 稽核報告的 P2 是用 node 層直接呼叫 $patch 重現的；這裡驗證真實路徑。
 */
// Phase 1 之後：全部 10 種壞資料都應正常渲染，無效項目被靜靜濾除。
// 第四欄 = 修正後應顯示的列數。
const BAD_PAYLOADS = [
  ['todoList 為 null', '{"todoList":null}', 0],
  ['todoList 為字串', '{"todoList":"oops"}', 0],
  ['todoList 為數字', '{"todoList":42}', 0],
  ['todoList 為物件', '{"todoList":{"a":1}}', 0],
  ['項目為 null', '{"todoList":[null]}', 0],
  ['項目缺 taskName', '{"todoList":[{"id":1,"isCompleted":false}]}', 0],
  ['taskName 為數字', '{"todoList":[{"id":1,"taskName":123,"isCompleted":false}]}', 0],
  ['pages 超出範圍', '{"todoList":[{"id":1,"taskName":"a","isCompleted":false}],"pages":7}', 1],
  ['整份不是物件', '"just a string"', 0],
  ['JSON 語法錯誤', '{todoList: [}', 0],
  ['混合有效與無效項目',
    '{"todoList":[{"id":1,"taskName":"有效","isCompleted":false},null,{"id":2,"taskName":99}]}', 1],
]

for (const [label, payload, expectedRows] of BAD_PAYLOADS) {
  test(`P2 已修正：${label} → 正常渲染，顯示 ${expectedRows} 列`, async ({ page }) => {
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
      `  P2 [${label.padEnd(18)}] ${verdict.padEnd(12)} ${parts}` +
        `  console: ${consoleErrors.length ? consoleErrors[0].slice(0, 45) : '無'}`,
    )

    // 稽核 P2 已修正：壞資料在進入 store 之前就被濾掉，畫面一律完整渲染
    expect(uncaught, `${label}：無未捕捉例外`).toEqual([])
    expect(consoleErrors, `${label}：無 console 錯誤`).toEqual([])
    expect(state.hasHeader, `${label}：header 正常渲染`).toBe(true)
    expect(state.hasTabs, `${label}：分頁列正常渲染`).toBe(3)
    expect(state.hasFooter, `${label}：footer 正常渲染`).toBe(true)
    expect(state.rows, `${label}：顯示列數`).toBe(expectedRows)
  })
}
