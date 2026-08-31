import { test, expect, type Page } from '@playwright/test'

/**
 * 稽核報告 U3：Demo 的實際互動走查。
 * 同時在真實瀏覽器中驗證 P1 / P2 / P17 的修正結果。
 */

interface IDBTaskRow {
  id: string
  taskName: string
  isCompleted: boolean
  order: number
  [key: string]: unknown
}

/** 直接從瀏覽器的 IndexedDB 讀出任務，驗證實際落地的形狀。 */
async function readTasksFromIDB(page: Page): Promise<IDBTaskRow[]> {
  return page.evaluate<IDBTaskRow[]>(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('todolist')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('tasks', 'readonly')
          const req = tx.objectStore('tasks').getAll()
          req.onsuccess = () => resolve(req.result as IDBTaskRow[])
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

// 每個 test 都有獨立的 browser context，localStorage 本來就是乾淨的。
// 不要用 addInitScript 清除 —— 它在每次 navigation 都會執行，reload 時會把資料一併清掉。
test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
})

test('U3: 增刪改查完整走查', async ({ page }) => {
  await page.goto('/#/all')

  // 新增
  await page.getByLabel('新增代辦事項').fill('買牛奶')
  await page.getByRole('button', { name: '新增' }).click()
  await page.getByLabel('新增代辦事項').fill('寫報告')
  await page.getByRole('button', { name: '新增' }).click()
  await expect(page.locator('main li')).toHaveCount(2)
  await expect(page.getByText('全部: 2 項')).toBeVisible()

  // 完成
  await page.locator('main li').first().locator('input[type=checkbox]').check()
  await expect(page.getByText('已完成: 1 項')).toBeVisible()
  await expect(page.locator('main li').first().locator('p').first()).toHaveClass(/line-through/)

  // 編輯
  await page.locator('main li').nth(1).getByRole('button', { name: '編輯' }).click()
  await page.getByRole('textbox', { name: /^編輯「/ }).fill('寫稽核報告')
  await page.locator('main li').nth(1).getByRole('button', { name: '保存' }).click()
  await expect(page.locator('main li p', { hasText: '寫稽核報告' })).toBeVisible()

  // 檢視切換
  await page.getByRole('link', { name: /^未完成/ }).click()
  await expect(page.locator('main li')).toHaveCount(1)
  await page.getByRole('link', { name: /^已完成/ }).click()
  await expect(page.locator('main li')).toHaveCount(1)
  await page.getByRole('link', { name: /^全部/ }).click()
  await expect(page.locator('main li')).toHaveCount(2)

  // 搜尋
  await page.getByRole('button', { name: '搜尋代辦事項' }).click()
  await page.getByLabel('搜尋代辦事項').fill('牛奶')
  await expect(page.locator('main li')).toHaveCount(1)
  await page.getByRole('button', { name: '結束搜尋' }).click()
  await expect(page.locator('main li')).toHaveCount(2)

  // 清除已完成
  await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
  await expect(page.locator('main li')).toHaveCount(1)

  // 刪除
  await page.locator('main li').first().getByRole('button', { name: '刪除' }).click()
  await expect(page.locator('main li')).toHaveCount(0)
})

test('U3b: 重新整理後資料仍在（持久化生效）', async ({ page }) => {
  await page.goto('/#/all')
  await page.getByLabel('新增代辦事項').fill('持久化測試')
  await page.getByRole('button', { name: '新增' }).click()

  // 同步點必須是「寫入已落地」，不能只是「畫面已更新」。
  // 兩者之間有一段真實的空窗：watcher 觸發的 IndexedDB 交易是非同步的，
  // 而 main.ts 已載明「操作後立刻重新整理」只能盡力而為。等 DOM 出現就重新整理
  // 等於在跟那段空窗賽跑，測到的會是時序而不是持久化。
  await expect.poll(async () => (await readTasksFromIDB(page)).length).toBe(1)

  await page.reload()
  await expect(page.locator('main li p', { hasText: '持久化測試' })).toBeVisible()
})

test('P1 已修正：編輯中重新整理會回到閱讀狀態，原文字完好', async ({ page }) => {
  await page.goto('/#/all')
  for (const t of ['原本的內容', '另一筆']) {
    await page.getByLabel('新增代辦事項').fill(t)
    await page.getByRole('button', { name: '新增' }).click()
  }

  await page.locator('main li').first().getByRole('button', { name: '編輯' }).click()
  await expect(page.getByRole('textbox', { name: /^編輯「/ })).toHaveValue('原本的內容')

  await page.reload()

  // 編輯狀態不再被持久化：重新整理後回到閱讀狀態
  await expect(page.getByRole('textbox', { name: /^編輯「/ }), '不應殘留編輯框').toHaveCount(0)
  await expect(page.locator('main li p', { hasText: '原本的內容' }), '原文字完好').toBeVisible()

  // 兩筆都能正常進入編輯，清單沒有被鎖住
  await page.locator('main li').nth(1).getByRole('button', { name: '編輯' }).click()
  await expect(page.getByRole('textbox', { name: /^編輯「/ })).toHaveValue('另一筆')
  await page.getByRole('textbox', { name: /^編輯「/ }).fill('改過的內容')
  await page.locator('main li').nth(1).getByRole('button', { name: '保存' }).click()
  await expect(page.locator('main li p', { hasText: '改過的內容' })).toBeVisible()
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
  await page.goto('/#/all')

  // 兩筆都在，且都以閱讀狀態呈現 —— 卡住的編輯狀態被自動解除
  await expect(page.locator('main li p', { hasText: '舊資料一' })).toBeVisible()
  await expect(page.locator('main li p', { hasText: '舊資料二' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^編輯「/ })).toHaveCount(0)
  await expect(page.getByText('全部: 2 項')).toBeVisible()
  await expect(page.getByText('已完成: 1 項')).toBeVisible()

  // 後續寫回的資料已是新形狀，且落在 IndexedDB
  await page.getByLabel('新增代辦事項').fill('新增一筆')
  await page.getByRole('button', { name: '新增' }).click()
  await expect(page.getByText('全部: 3 項')).toBeVisible()

  const rows = await readTasksFromIDB(page)
  expect(rows).toHaveLength(3)
  expect(rows.some((t) => 'isEdit' in t), '舊的 isEdit 欄位應已消失').toBe(false)
  expect(rows.every((t) => typeof t.order === 'number'), '每一列都要有排序鍵').toBe(true)

  // 原始 localStorage 資料保留，讓回滾舊版仍讀得到
  const legacy = await page.evaluate(() => localStorage.getItem('todoTask'))
  expect(legacy, '不刪除舊資料').not.toBeNull()
})

test('P1 已修正：編輯狀態不落地，儲存形狀乾淨', async ({ page }) => {
  await page.goto('/#/all')
  await page.getByLabel('新增代辦事項').fill('檢查持久化形狀')
  await page.getByRole('button', { name: '新增' }).click()
  await expect(page.getByText('全部: 1 項')).toBeVisible()
  await page.locator('main li').first().getByRole('button', { name: '編輯' }).click()

  const rows = await readTasksFromIDB(page)
  expect(rows).toHaveLength(1)
  // v2 的形狀：編輯狀態不落地，但多了到期日、優先度等欄位
  expect(Object.keys(rows[0] ?? {})).not.toContain('isEdit')
  expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
    'completedAt', 'createdAt', 'dueDate', 'dueTime', 'id', 'isCompleted',
    'notes', 'order', 'parentId', 'priority', 'projectId', 'recurrence',
    'tagIds', 'taskName', 'updatedAt',
  ])
})

test('P17 已修正：id 為 UUID，不再是可能碰撞的時間戳', async ({ page }) => {
  await page.goto('/#/all')
  for (const name of ['一', '二', '三']) {
    await page.getByLabel('新增代辦事項').fill(name)
    await page.getByRole('button', { name: '新增' }).click()
  }
  await expect(page.getByText('全部: 3 項')).toBeVisible()

  const rows = await readTasksFromIDB(page)
  const ids = rows.map((t) => t.id)
  expect(new Set(ids).size, 'id 必須互異').toBe(3)
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  }
})

/**
 * P2 調查：在真實瀏覽器的完整流程下，各種壞資料實際會發生什麼事。
 * 稽核報告的 P2 是用 node 層直接呼叫 $patch 重現的；這裡驗證真實路徑。
 */
// Phase 1 之後：全部 10 種壞資料都應正常渲染，無效項目被靜靜濾除。
// 第四欄 = 修正後應顯示的列數。
const BAD_PAYLOADS: Array<[label: string, payload: string, expectedRows: number]> = [
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
    const uncaught: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (e) => uncaught.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.addInitScript((p) => {
      window.localStorage.setItem('todoTask', p)
    }, payload)
    await page.goto('/#/all')
    await page.waitForTimeout(300)

    const state = await page.evaluate(() => ({
      appLen: (document.querySelector('#app') as HTMLElement).innerHTML.length,
      hasHeader: !!document.querySelector('h1'),
      navLinks: document.querySelectorAll('nav a').length,
      hasFooter: !!document.querySelector('button[data-test=clear-completed]'),
      rows: document.querySelectorAll('main li').length,
    }))

    const parts = [
      state.hasHeader ? 'Header✓' : 'Header✗',
      state.navLinks >= 7 ? '導覽✓' : `導覽✗(${state.navLinks})`,
      state.hasFooter ? 'Footer✓' : 'Footer✗',
      `列數=${state.rows}`,
    ].join(' ')

    const verdict = state.appLen === 0 ? '完全白畫面' : state.hasFooter ? '完整渲染' : '部分渲染失敗'
    console.log(
      `  P2 [${label.padEnd(18)}] ${verdict.padEnd(12)} ${parts}` +
        `  console: ${consoleErrors[0]?.slice(0, 45) ?? '無'}`,
    )

    // 稽核 P2 已修正：壞資料在進入 store 之前就被濾掉，畫面一律完整渲染
    expect(uncaught, `${label}：無未捕捉例外`).toEqual([])
    expect(consoleErrors, `${label}：無 console 錯誤`).toEqual([])
    expect(state.hasHeader, `${label}：header 正常渲染`).toBe(true)
    // 側邊欄的固定入口：今天／即將到來／收件匣／全部／未完成／已完成／統計
    expect(state.navLinks, `${label}：導覽正常渲染`).toBe(7)
    expect(state.hasFooter, `${label}：footer 正常渲染`).toBe(true)
    expect(state.rows, `${label}：顯示列數`).toBe(expectedRows)
  })
}
