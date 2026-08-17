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
  },
})
