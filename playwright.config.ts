import { defineConfig, devices } from '@playwright/test'

/** 模擬 GitHub Pages 子路徑部署的 origin，供 deploy.spec.ts 使用。 */
export const SUBPATH_BASE = 'http://localhost:4320/Vue-TodoList/'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4319',
    trace: 'on-first-retry',
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
      command: 'node scripts/serve-subpath.mjs 4320 /Vue-TodoList/',
      url: SUBPATH_BASE,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
