import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Playwright 用 Node 原生 ESM 載入這個檔案，import 屬性寫法在不同 Node 版本間不穩定，
// 改用 fs 讀檔避免踩坑（scripts/serve-subpath.mjs 同理）。
const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')) as {
  name: string
}

/**
 * 模擬 GitHub Pages 子路徑部署的 origin，供 deploy.spec.ts 使用。
 * 子路徑取自 package.json 的 name，跟著 repo 名稱走，改名時不必手動同步。
 */
export const SUBPATH_BASE = `http://localhost:4320/${pkg.name}/`

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  /**
   * CI 專用的設定，全部來自一次實際的 CI 失敗：
   * 那次只有「E2E 失敗」四個字，沒有報告、沒有 trace、沒有截圖，
   * 而本機重跑 60 條全過——完全無法判斷是偶發還是真的壞了。
   */

  // 只用 list reporter 時不會產生 playwright-report/，
  // workflow 裡「失敗時上傳報告」那一步等於空跑。
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  // 沒有 retries 時，偶發失敗會直接擋掉建置，而且無從得知它是偶發的。
  // 有 retries 時 Playwright 會把「重試後才過」標記為 flaky，
  // 讓偶發與真實失敗在報告上分得開。
  retries: isCI ? 2 : 0,

  // 多個 worker 共用同一組 webServer（4319/4320）。本機無妨，
  // 但 CI runner 較慢時容易出現彼此干擾的競態。CI 上換取確定性。
  //
  // 用條件展開而非 `workers: isCI ? 1 : undefined`：tsconfig 開了
  // exactOptionalPropertyTypes，明確指派 undefined 給選用屬性會被拒絕。
  // 這裡要的是「本機不設這個屬性」，不是「設成 undefined」。
  ...(isCI ? { workers: 1 } : {}),

  // 誤留 test.only 會讓 CI 只跑那一條卻顯示綠燈——比失敗更危險。
  forbidOnly: isCI,

  use: {
    baseURL: 'http://localhost:4319',
    // 封鎖 service worker：它會跨測試快取回應，讓失敗變得無法重現。
    // PWA 本身改用「產物是否正確」來驗證（見 deploy.spec.ts），
    // 那是這一層測得準的部分。
    serviceWorkers: 'block',
    // 失敗時保留可事後追查的證據，而不是只留一行錯誤訊息
    trace: isCI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // 專用 port，且一律自行啟動：沿用既有伺服器曾導致測試連到別的專案。
      command: 'pnpm build && pnpm preview --port 4319 --strictPort',
      url: 'http://localhost:4319',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // 同一份 dist 掛在子路徑下，持續驗證 GitHub Pages 的部署形狀。
      command: 'node scripts/serve-subpath.mjs 4320',
      url: SUBPATH_BASE,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
