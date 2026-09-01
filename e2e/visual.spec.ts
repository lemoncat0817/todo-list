import { test, expect, type Page } from '@playwright/test'

/**
 * 視覺驗證。
 *
 * 這份測試存在的理由是一次真實的失誤：Tailwind 4 遷移後整個樣式跑版，
 * 而單元測試（檢查 class 名稱）與 axe（檢查有渲染出來的顏色對比）
 * 全部綠燈 —— 因為 utility「有出現在 class 屬性裡」跟「真的生效」是兩回事。
 *
 * 根因是 CSS cascade layers：未分層的舊 reset.css 優先權高於
 * Tailwind 放在 @layer utilities 裡的所有 utility，把 font/border/margin 全吃掉。
 *
 * 所以這裡不比對 class，而是斷言 getComputedStyle 的實際結果。
 */

/**
 * 這些測試會在同一個 browser context 內反覆 seed（不同視窗寬度、不同主題），
 * 而 IndexedDB 是跨 navigation 保留的——不先清掉，數量會一輪一輪累加。
 */
async function seed(page: Page, names: string[] = ['買牛奶']): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto('/#/all')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('todolist')
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      }),
  )
  await page.reload()

  for (const name of names) {
    await page.getByLabel('新增代辦事項').fill(name)
    await page.getByRole('button', { name: '新增' }).click()
  }
  await expect(page.getByText(`全部: ${names.length} 項`)).toBeVisible()
}

/** 讀出實際生效的樣式，而不是 class 字串。 */
async function computed(page: Page, selector: string, props: string[]) {
  return page.evaluate(
    ([sel, list]) => {
      const el = document.querySelector(sel as string)
      if (!el) return null
      const s = getComputedStyle(el)
      return Object.fromEntries((list as string[]).map((p) => [p, s.getPropertyValue(p)]))
    },
    [selector, props] as const,
  )
}

test('Tailwind utility 真的生效，而不只是出現在 class 屬性裡', async ({ page }) => {
  await seed(page)

  const h1 = await computed(page, 'h1', ['font-size', 'font-weight'])
  console.log('\n  h1:', JSON.stringify(h1))

  // 標題掛著 text-3xl font-bold。若 utility 沒生效（例如被未分層的 reset 蓋掉），
  // 會退回瀏覽器預設的 32px/bold 或 reset 的 16px/inherit —— 兩者都不是 30px。
  expect(h1, 'h1 應存在').not.toBeNull()
  expect(
    parseFloat(h1!['font-size'] as string),
    'text-3xl 應解析為 30px；若是 16px 代表 utility 被未分層樣式蓋掉',
  ).toBeGreaterThanOrEqual(24)
  expect(Number(h1!['font-weight']), 'font-bold 應為 700').toBeGreaterThanOrEqual(600)
})

test('邊框與間距 utility 生效', async ({ page }) => {
  await seed(page)

  // 側邊欄裡也有 li，這裡要量的是任務列，所以限定在 main 之內
  const row = await computed(page, 'main li', ['border-top-width', 'padding-left', 'display'])
  console.log('  main li:', JSON.stringify(row))

  expect(parseFloat(row!['border-top-width'] as string), '邊框不該被 reset 的 border:0 吃掉')
    .toBeGreaterThan(0)
  expect(parseFloat(row!['padding-left'] as string), '間距不該被 reset 的 padding:0 吃掉')
    .toBeGreaterThan(0)
})

test('側邊欄連結是有版面的區塊，不是裸露的行內文字', async ({ page }) => {
  await seed(page)

  const tab = await computed(page, 'nav a', ['display', 'width', 'border-radius', 'background-color'])
  console.log('  nav a:', JSON.stringify(tab))

  expect(tab!['display'], '不應是預設的 inline').not.toBe('inline')
  expect(parseFloat(tab!['width'] as string), '應有明確寬度').toBeGreaterThan(40)
  expect(parseFloat(tab!['border-radius'] as string), 'rounded 應生效').toBeGreaterThan(0)
})

test('頁面沒有水平溢出', async ({ page }) => {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await seed(page, ['一個比較長的待辦事項名稱用來測試換行'])

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    console.log(`  viewport ${width}px → 水平溢出 ${overflow}px`)
    expect(overflow, `${width}px 不應有水平溢出`).toBeLessThanOrEqual(0)
  }
})

test('擷取各斷點與主題的畫面', async ({ page }, testInfo) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const [label, width] of [
      ['mobile', 375],
      ['desktop', 1280],
    ] as const) {
      await page.setViewportSize({ width, height: 900 })
      await seed(page, ['買牛奶', '寫報告', '安排會議'])
      await testInfo.attach(`${scheme}-${label}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    }
  }
})

test('對話框置中，不會被 preflight 的 margin:0 打到左上角', async ({ page }) => {
  // 1280px 以上詳情是常駐右欄而非對話框，這裡刻意用中等寬度取得對話框形態
  await page.setViewportSize({ width: 1024, height: 800 })
  await seed(page)
  await page.getByRole('button', { name: /設定/ }).first().click()

  const box = await page.evaluate(() => {
    const d = document.querySelector('dialog') as HTMLDialogElement
    const r = d.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      vw: window.innerWidth,
      marginInline: getComputedStyle(d).marginLeft,
    }
  })
  console.log('\n  dialog:', JSON.stringify(box))

  // 原生 <dialog> 的置中來自 UA stylesheet 的 margin:auto，
  // 而 Tailwind preflight 會把它重設為 0。少了 m-auto 就會貼到左上角。
  expect(box.marginInline, 'margin 不可為 0，否則置中失效').not.toBe('0px')
  const leftGap = box.left
  const rightGap = box.vw - box.right
  expect(Math.abs(leftGap - rightGap), '左右留白應相等（水平置中）').toBeLessThan(2)
})
