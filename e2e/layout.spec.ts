import { test, expect } from '@playwright/test'

/**
 * 稽核報告 U1 / U2：版面與 RWD 的實際量測。
 * 這些數字先前無法驗證，只能列為「未驗證」；這裡把它們轉成事實。
 */

const WIDTHS = [320, 375, 768, 1024]

test('U1: 各裝置寬度下的水平溢出量測', async ({ page }) => {
  const rows = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.waitForSelector('h1')

    const m = await page.evaluate(() => {
      const box = document.querySelector('.app > div') as HTMLElement
      const r = box.getBoundingClientRect()
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        boxWidth: Math.round(r.width),
        boxLeft: Math.round(r.left),
        boxRight: Math.round(r.right),
      }
    })
    rows.push({ width, ...m, overflow: m.docScrollWidth - m.innerWidth })
  }

  console.log('\n  U1 — 外框 w-[700px] 在各寬度下的實際表現')
  console.log('  viewport | 外框實際寬 | 文件捲動寬 | 水平溢出 | 外框左緣 右緣')
  console.log('  ---------|-----------|-----------|---------|---------------')
  for (const r of rows) {
    console.log(
      `  ${String(r.width).padStart(8)} | ${String(r.boxWidth).padStart(9)} | ` +
        `${String(r.docScrollWidth).padStart(9)} | ${String(r.overflow).padStart(7)} | ` +
        `${String(r.boxLeft).padStart(6)} ${String(r.boxRight).padStart(6)}`,
    )
  }

  // README.md:3 與 :29 宣稱最小支援寬度 320px。逐一驗證。
  for (const r of rows) {
    expect(r.overflow, `viewport ${r.width}px 不應有水平溢出`).toBeLessThanOrEqual(0)
  }
})

test('U1b: 320px 下各元素是否被裁切', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await page.getByPlaceholder('請輸入代辦事項').fill('量測用項目')
  await page.getByRole('button', { name: '+' }).click()

  const clipped = await page.evaluate(() => {
    const vw = window.innerWidth
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.left < -0.5 || r.right > vw + 0.5) {
        out.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 18),
          left: Math.round(r.left),
          right: Math.round(r.right),
        })
      }
    }
    return out
  })

  console.log(`\n  U1b — 320px 下超出視窗的元素：${clipped.length} 個`)
  for (const c of clipped.slice(0, 12)) {
    console.log(`    <${c.tag}> "${c.text}"  left=${c.left} right=${c.right}`)
  }
  expect(clipped, '320px 下不應有元素超出視窗').toEqual([])
})

test('U2: 100vh vs 視窗高度', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')

  const m = await page.evaluate(() => {
    const app = document.querySelector('.app') as HTMLElement
    return {
      appHeight: Math.round(app.getBoundingClientRect().height),
      innerHeight: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      usesDvh: getComputedStyle(app).minHeight,
    }
  })

  console.log('\n  U2 — App.vue:2 的 min-h-[100vh]')
  console.log(`    computed min-height : ${m.usesDvh}`)
  console.log(`    .app 實際高度       : ${m.appHeight}px`)
  console.log(`    window.innerHeight  : ${m.innerHeight}px`)
  console.log(`    文件捲動高度        : ${m.docScrollHeight}px`)
  console.log(`    垂直溢出            : ${m.docScrollHeight - m.innerHeight}px`)

  expect(m.appHeight).toBeGreaterThanOrEqual(m.innerHeight)
})
