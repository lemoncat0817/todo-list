# Todo List

一個純前端的代辦事項工具。資料存在瀏覽器的 IndexedDB，不需要帳號、不需要後端。

**Demo**：https://lemoncat0817.github.io/Vue-TodoList/

## 功能

**任務**
- 新增、編輯、刪除、完成／取消完成
- 備註、優先度（無／低／中／高）
- 到期日與時間，逾期會以紅色標示
- 專案分類與標籤（可就地建立）

**重複性任務**
- 每日／每週（可指定星期）／每月，可設間隔
- 結束條件：指定次數或截止日
- 完成時把到期日推進到下一次，而不是預先產生無限筆
- 月底日期的處理：1/31 的下個月是 2/28（閏年 2/29），不會溢位到 3/3

**組織與檢視**
- 三個檢視各自對應一個網址（`/`、`/#/active`、`/#/completed`），可深連結、可分享
- 搜尋大小寫不敏感，全形半形通用
- 拖曳排序，或用每列的上移／下移按鈕

**復原**
- 刪除、清除已完成、全選等操作都可復原，不用先跳確認對話框
- `Ctrl`/`Cmd` + `Z`，或提示列上的「復原」按鈕

**快捷鍵**

| 按鍵 | 動作 |
| --- | --- |
| `n` | 聚焦新增欄位 |
| `/` | 聚焦搜尋 |
| `Ctrl`/`Cmd` + `Z` | 復原 |
| `Esc` | 關閉提示／取消編輯 |

在輸入框內打字時不會攔截按鍵（`Esc` 除外）。

## 無障礙

通過 WCAG 2.1 AA，並以 `@axe-core/playwright` 在 CI 自動驗證，
涵蓋六個情境（三個檢視、編輯中、搜尋模式、空清單），**零違規**。

- 所有互動元素可鍵盤操作，拖曳只是指標裝置的增強而非唯一路徑
- 目前檢視以 `aria-current` 標示，不只靠顏色
- 對話框使用原生 `<dialog>` 的 `showModal()`，焦點鎖定與 `Esc` 由平台提供
- 色彩對比全數達標（最低一組 4.55:1）

## 技術棧

| 套件 | 版本 | 備註 |
| --- | --- | --- |
| Vue | 3.5.41 | Composition API only，關閉 Options API 分支以減少產物 |
| Pinia | 4.0.3 | |
| Vue Router | 5.2.0 | hash 模式，見下方說明 |
| Vite | 8.2.1 | |
| TypeScript | ~6.0.3 | **刻意不用 7.x**，見下方說明 |
| Tailwind CSS | 3.4.4 | |
| idb | 8.0.3 | IndexedDB 封裝 |
| Vitest | 4.1.10 | 231 條單元測試 |
| Playwright | 1.62.1 | 52 條 E2E |
| ESLint | 10.8.1 | 含 vuejs-accessibility |

### 兩個刻意的版本決定

**TypeScript 釘在 `~6.0.3` 而非 `^`**
`vue-tsc@3.3.10` 配 TypeScript 7 會直接崩潰
（`ERR_PACKAGE_PATH_NOT_EXPORTED: './lib/tsc'`）。
vue-tsc 的 peer 只寫 `>=5.0.0` 沒有上界，套件管理器不會警告，
所以用 `~` 鎖住次版本，避免哪天「順手升 TypeScript」就壞掉。

**Vue Router 用 hash 模式**
GitHub Pages 沒有 SPA fallback——實測 `/Vue-TodoList/active` 直接回 404。
hash 片段不會送到伺服器，因此不需要 `404.html` 這類技巧，重新整理也不會掛。

## 資料

任務存在 IndexedDB（資料庫 `todolist`，目前 schema v2）。
搜尋模式這類 UI 偏好留在 localStorage。

舊版把任務存在 localStorage。首次開啟新版時會**一次性遷移**：
逐筆驗證形狀，壞掉的項目被跳過而不是讓整批失敗，
並且**不刪除 localStorage 的原始資料**，保留回滾舊版的可能。

## 開發

需要 Node `^20.19.0 || >=22.12.0` 與 pnpm。

```sh
pnpm install
pnpm dev          # 開發伺服器
pnpm build        # 生產建置
pnpm preview      # 預覽建置產物

pnpm typecheck    # vue-tsc
pnpm lint         # ESLint
pnpm test         # Vitest 單元測試
pnpm test:e2e     # Playwright E2E（含無障礙檢測）
```

## 部署

推送到 `master` 會由 `.github/workflows/deploy.yml` 自動建置並發布到 GitHub Pages。

`vite.config.ts` 的 `base: './'` 產出相對路徑，是子路徑部署能運作的原因，**不要改成絕對路徑**。
`e2e/deploy.spec.ts` 會把產物掛在 `/Vue-TodoList/` 之下模擬實際部署形狀並驗證——
若只測根路徑，改壞 `base` 會完全靜默地通過，直到線上全部 404。

> 首次啟用需要把 repo 的 Settings → Pages → Source 設為 **GitHub Actions**。

## 支援寬度

實測 320／375／768／1024 四種寬度水平溢出皆為 0，320px 下無任何元素超出視窗。
