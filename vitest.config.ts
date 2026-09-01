import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 與 vite.config.ts 分開：Vite 8 的 UserConfig 型別不再接受 test 欄位，
// 寫在一起會讓 vue-tsc 報 TS2769。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    // e2e 由 Playwright 執行，不要讓 Vitest 收進來。
    include: ['src/**/*.spec.ts'],
    // Vitest 底層用 Vite 的 loadEnv，預設會讀本機的 .env.local——一旦開發者
    // 為了跑 pnpm dev 而接了真的 Supabase 專案，isSyncConfigured 在單元測試
    // 裡就會意外變成 true，「沒設定 Supabase 時同步入口不顯示」這類測試
    // 會因為別人的本機環境而跟 CI 跑出不同結果。單元測試永遠假設沒接
    // Supabase；哪個測試檔真的需要 isSyncConfigured 為 true，用
    // vi.mock('@/sync/config', ...) 明確宣告，不要依賴環境。
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})
