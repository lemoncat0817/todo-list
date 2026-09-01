import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import pluginA11y from 'eslint-plugin-vuejs-accessibility'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
  {
    name: 'app/files',
    files: ['**/*.{ts,vue}'],
  },
  {
    name: 'app/ignores',
    ignores: ['dist/**', 'coverage/**', 'test-results/**', 'playwright-report/**'],
  },

  js.configs.recommended,
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  // 無障礙靜態檢查。目前先讓它以警告可見，暫不擋建置；
  // 待逐步修正到零違規後，下方 app/a11y-pending 覆寫區塊即可整段刪除。
  ...pluginA11y.configs['flat/recommended'],

  {
    name: 'app/rules',
    rules: {
      // 元件檔名沿用專案既有的 camelCase（todoHeader.vue），暫不重新命名。
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // 純排版規則：現有樣板全部觸發，目標是零行為變更、零視覺變更，
      // 因此暫不做大規模重排；日後若重寫樣板，屆時再開回來。
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/attributes-order': 'off',

      // 預設同時要求「label 包住控制項」與「for 屬性」。
      // 包裹式 label 本身就是合法且可及的關聯方式，接受其中一種即可。
      'vuejs-accessibility/label-has-for': [
        'error',
        { required: { some: ['nesting', 'id'] }, allowChildren: true },
      ],
    },
  },
  {
    name: 'app/a11y-pending',
    // 這三條精準命中稽核報告的 P6（分頁標籤是 div，鍵盤不可操作）與
    // P7（checkbox 無可及名稱）—— lint 獨立證實了人工稽核的結論。
    // 修正後把這一段整個刪掉，讓它們回到 error。
    rules: {
      'vuejs-accessibility/click-events-have-key-events': 'warn',
      'vuejs-accessibility/no-static-element-interactions': 'warn',
      'vuejs-accessibility/form-control-has-label': 'warn',
    },
  },
  {
    // 在 Node 執行的腳本與設定檔：需要 Node 全域（process、Buffer…）。
    name: 'app/node-scripts',
    files: ['scripts/**/*.{mjs,js,ts}', '*.config.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    name: 'app/tests',
    files: ['**/*.spec.ts', 'src/test/**/*.ts'],
    rules: {
      // 測試中會刻意餵入違反型別契約的資料來驗證執行期韌性
      '@typescript-eslint/no-explicit-any': 'off',
      // 測試會建立多個 createApp 樁來安裝 pinia，這條規則在此是誤判
      'vue/one-component-per-file': 'off',
    },
  },
)
