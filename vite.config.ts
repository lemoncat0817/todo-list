import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 子路徑部署需要相對路徑，實測有效，不要改成絕對路徑。
  base: './',
  define: {
    // 本專案只用 Composition API（<script setup>），關掉 Options API 與
    // devtools 分支讓 Vue 能被搖掉。實測省下 3.11 kB（gzip 1.19 kB）。
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
