import { test, expect } from '@playwright/test'
import { SUBPATH_BASE } from '../playwright.config'

/**
 * 部署形狀驗證。
 *
 * 這些測試刻意不走 baseURL，而是連到掛在 SUBPATH_BASE（子路徑，見 playwright.config.ts）之下的第二個伺服器，
 * 模擬 GitHub Pages 的實際部署路徑。目的是讓「能不能部署」在每一個階段都被
 * 自動驗證，而不是等到最後才發現。
 */

test.describe('GitHub Pages 子路徑部署', () => {
  test('首頁與所有資產都在子路徑下正常回應', async ({ page }) => {
    const responses: { url: string; status: number }[] = []
    page.on('response', (r) => {
      responses.push({ url: r.url(), status: r.status() })
    })

    await page.goto(SUBPATH_BASE)
    await page.waitForSelector('h1')

    const failed = responses.filter((r) => r.status >= 400)
    console.log(`\n  子路徑請求數: ${responses.length}，失敗: ${failed.length}`)
    for (const r of responses) {
      console.log(`    ${r.status}  ${r.url.replace('http://localhost:4320', '')}`)
    }
    expect(failed, '子路徑下不應有任何資產載入失敗').toEqual([])
  })

  test('資產路徑為相對路徑（base:"./" 未被改壞）', async ({ page }) => {
    await page.goto(SUBPATH_BASE)
    const srcs = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
      styles: [...document.querySelectorAll('link[rel=stylesheet]')].map((s) =>
        s.getAttribute('href'),
      ),
    }))
    console.log('\n  script src:', srcs.scripts, '\n  style href:', srcs.styles)

    for (const ref of [...srcs.scripts, ...srcs.styles]) {
      expect(ref, '資產必須是相對路徑，絕對路徑會讓子路徑部署 404').not.toMatch(/^\//)
    }
  })

  test('App 在子路徑下能完整操作，資料也能持久化', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await page.goto(SUBPATH_BASE)

    await page.getByLabel('新增代辦事項').fill('子路徑下的待辦')
    await page.getByRole('button', { name: '新增' }).click()
    await expect(page.locator('main li p', { hasText: '子路徑下的待辦' })).toBeVisible()
    await expect(page.getByText('全部: 1 項')).toBeVisible()

    await page.reload()
    await expect(page.locator('main li p', { hasText: '子路徑下的待辦' }), '重新整理後資料仍在').toBeVisible()
  })

  test('未知路徑回 404 —— 記錄 GitHub Pages 無 SPA fallback 的事實', async ({ page }) => {
    const res = await page.goto(`${SUBPATH_BASE}active`)
    expect(res?.status(), 'GitHub Pages 對未知路徑不做 fallback').toBe(404)
  })

  test('PWA 的產物都在子路徑下就位，且路徑是相對的', async ({ page }) => {
    // service worker 在測試中被封鎖（見 playwright.config.ts），
    // 所以這裡驗證的是「安裝所需的檔案是否正確產出並可取得」——
    // 那是這一層測得準的部分，執行期行為留給真實瀏覽器。
    await page.goto(SUBPATH_BASE)

    const manifestHref = await page.getAttribute('link[rel=manifest]', 'href')
    expect(manifestHref, 'manifest 必須是相對路徑，否則子路徑部署會 404').not.toMatch(/^\//)

    const manifestUrl = new URL(manifestHref ?? '', page.url()).href
    const manifest = await page.request.get(manifestUrl)
    expect(manifest.status()).toBe(200)

    const parsed = (await manifest.json()) as {
      start_url: string
      scope: string
      icons: { src: string }[]
    }
    console.log('\n  manifest:', JSON.stringify(parsed).slice(0, 160))
    expect(parsed.start_url, 'start_url 要相對於 manifest').toBe('./')
    expect(parsed.scope).toBe('./')

    for (const icon of parsed.icons) {
      const res = await page.request.get(new URL(icon.src, manifestUrl).href)
      expect(res.status(), `圖示 ${icon.src} 應存在`).toBe(200)
    }

    const sw = await page.request.get(new URL('sw.js', page.url()).href)
    expect(sw.status(), 'service worker 檔案應可取得').toBe(200)
  })

  test('hash 深連結可直接開啟並重新整理', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    // hash 片段不會送到伺服器，所以任何 hash 路徑都會拿到 index.html。
    // 這就是本專案採用 hash 路由而非 history 模式的原因。
    const res = await page.goto(`${SUBPATH_BASE}#/completed`)
    expect(res?.status()).toBe(200)
    await expect(page.locator('h1')).toBeVisible()

    await page.reload()
    expect(page.url()).toContain('#/completed')
    await expect(page.locator('h1'), '重新整理後仍可用').toBeVisible()
  })
})
