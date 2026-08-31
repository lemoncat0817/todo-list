# Todo List

一個純前端的代辦事項工具。資料存在瀏覽器的 IndexedDB。

[![CI](https://github.com/lemoncat0817/todo-list/actions/workflows/ci.yml/badge.svg)](https://github.com/lemoncat0817/todo-list/actions/workflows/ci.yml)
[![Deploy](https://github.com/lemoncat0817/todo-list/actions/workflows/deploy.yml/badge.svg)](https://github.com/lemoncat0817/todo-list/actions/workflows/deploy.yml)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

**Demo**：https://lemoncat0817.github.io/todo-list/

## 功能

**任務**
- 新增、編輯、刪除、完成／取消完成
- 備註、優先度 P1–P4（P1 最高，沿用 Todoist 慣例）
- 到期日與時間，逾期會以紅色標示
- 專案分類與標籤（可就地建立）
- 子任務（一層），可展開收合並顯示 `3/5` 進度
- 每列都有排程選單：今天／明天／本週末／下週一鍵改期

**快速新增**

一行寫完一筆任務，送出前就看得到解析結果：

```
明天下午3點 交季報 p1 #工作 @公司
```

| 語法 | 例子 |
| --- | --- |
| 日期 | `今天` `明天` `後天` `週五` `下週一` `3天後` `3/15` `2030-01-15` |
| 時間 | `下午3點` `晚上8點半` `9:05` `3pm` |
| 優先度 | `p1`（最高）～ `p4` |
| 專案 | `#工作`（不存在會順手建立） |
| 標籤 | `@公司`（可多個） |
| 重複 | `每天` `每3天` `每週一` `每月` |

整句都被解析掉時（例如只打「明天」）會退回原文當名稱，
不會產生一筆沒有名字的任務。

**重複性任務**
- 每日／每週（可指定星期）／每月，可設間隔
- 結束條件：指定次數或截止日
- 完成時把到期日推進到下一次，而不是預先產生無限筆
- 月底日期的處理：1/31 的下個月是 2/28（閏年 2/29），不會溢位到 3/3

**組織與檢視**
- 側邊導覽：今天／即將到來／收件匣，以及每個專案與標籤各自的入口
- 每個檢視都有自己的網址（`/#/today`、`/#/project/<id>`…），可深連結、可分享
- 「今天」與「即將到來」都會把逾期任務聚集在最上方，不讓它隨日期沉下去
- 在某個檢視裡新增會繼承該檢視的脈絡（在專案裡新增就屬於那個專案）
- 專案與標籤可改名、換色、刪除；刪除專案時底下的任務移到未分類
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

## 版面

| 寬度 | 導覽 | 詳情 |
| --- | --- | --- |
| < 1024px | 抽屜（原生 `<dialog>`） | 對話框 |
| ≥ 1024px | 常駐左欄 | 對話框 |
| ≥ 1280px | 常駐左欄 | 常駐右欄 |

## 無障礙

通過 WCAG 2.1 AA，並以 `@axe-core/playwright` 在 CI 自動驗證，
涵蓋十個情境（六個檢視、編輯中、管理對話框、導覽抽屜、空清單），**零違規**。

- 所有互動元素可鍵盤操作，拖曳只是指標裝置的增強而非唯一路徑
- 目前檢視以 `aria-current` 標示，不只靠顏色
- 對話框使用原生 `<dialog>` 的 `showModal()`，焦點鎖定與 `Esc` 由平台提供
- 色彩對比全數達標（最低一組 4.55:1）

## 技術棧

| 套件 | 版本 | 備註 |
| --- | --- | --- |
| Vue | 3.5.41 | Composition API only，關閉 Options API 分支以減少產物 |
| Pinia | 4.0.3 | |
| Vue Router | 5.2.0 | hash 模式 |
| Vite | 8.2.1 | |
| TypeScript | ~6.0.3 | |
| Tailwind CSS | 3.4.4 | |
| idb | 8.0.3 | IndexedDB 封裝 |
| Vitest | 4.1.10 | 231 條單元測試 |
| Playwright | 1.62.1 | 52 條 E2E |
| ESLint | 10.8.1 | 含 vuejs-accessibility |

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
