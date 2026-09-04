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
- 備註、優先度 P1–P4（P1 最高）
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

**批次與鍵盤**
- `Ctrl`/`Cmd` + 點擊或 `x` 多選，整批改期／改優先度／移動專案／刪除
- 每一批只算一次復原：按一次「全部順延」是一個決定，復原時也一次回到原狀
- `j`／`k` 在列之間移動（走真正的 DOM 焦點），`e` 編輯、`t` 排程、`Enter` 開詳情
- `Ctrl`/`Cmd` + `K` 命令面板：檢視、專案、標籤、篩選器、任務、動作都在同一個清單
- `?` 開啟完整的快捷鍵說明

**排序、分組與篩選器**
- 排序：手動順序／到期日／優先度／名稱／建立時間（記在偏好裡，不放網址）
- 分組：不分組／專案／優先度（今天與即將到來本來就以日期分組，不再疊一層）
- 篩選器查詢語言，可存成側邊欄的入口：

```
today & p1 & #工作
(overdue | today) & !@等待中
```

| 條件 | 說明 |
| --- | --- |
| `today` `overdue` `upcoming` `nodate` | 日期 |
| `done` `todo` | 完成狀態 |
| `p1`–`p4` | 優先度 |
| `#專案` `@標籤` | 分類 |
| `&` `|` `!` `( )` | 且、或、非、分組 |
| `"文字"` | 照字面搜尋（可搜到保留字本身） |

查詢寫錯時會說「篩選條件無法解析」，不會安靜地顯示成「沒有符合的項目」。

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

**資料、提醒與統計**
- JSON 匯出／匯入（合併或取代），匯入走既有的邊界驗證，壞掉的列只會濾掉那一列並回報筆數
- 匯入整份只算一次復原，選錯檔案按一次 `Ctrl`/`Cmd` + `Z` 就回到原狀
- 可安裝為 PWA、可離線使用（service worker 採網路優先、失敗才回快取）
- 到期提醒（**僅在分頁開著時有效**——這是本地輪詢，不是推播；被 @提及／指派任務的推播通知是另一回事，見下方「協作」）
- 統計頁：今天／最近七天完成數、連續天數、最近 14 天走勢、最近完成清單

**帳號與跨裝置同步（選配）**
- 預設仍是純本地：不設定 Supabase 環境變數，「帳號與同步」入口整個不顯示，行為與純前端版本完全一樣
- 登入方式：Google／GitHub 一鍵登入，沒有密碼（信箱登入連結目前暫時隱藏）
- 登入的裝置之間會互相同步任務／專案／標籤／篩選器
- 同步是背景輪詢（開分頁、每 30 秒、恢復網路、本地編輯後三秒）加 Realtime 補洞，**不是完全即時**，但已支援多人共編（見下方「協作」）
- 欄位級補丁，不是整列覆蓋：兩人同時改同一筆任務的不同欄位不會互蓋，只有真的改到同一個欄位才會以較晚寫入的一方為準（比較 `updatedAt`）
- 登出只斷開同步，不會刪除本地資料
- 部署與本機開發設定見 [`.env.local.example`](.env.local.example) 與 [`supabase/migrations/`](supabase/migrations)；
  要開啟 Google／GitHub 登入，另外要在 Supabase Dashboard 的 Authentication → Providers 設定，
  步驟見下方「啟用 Google／GitHub 登入」

**協作（需先接上跨裝置同步）**
- 工作區與五種角色（owner／admin／member／commenter／viewer），可寄出邀請連結、隨時撤換或重寄
- 共享專案：同一個工作區的成員即時看到彼此的任務變動（Realtime 訂閱＋斷線補拉）
- 任務可指派給單一負責人，指派對象只能是這個工作區的成員
- 任務留言與 @提及、伺服器產生的活動記錄（誰在何時做了什麼，不是前端猜的）
- 附件（Supabase Storage，私有 bucket，只能透過簽名網址取得，單檔 10MB、單一工作區總量 500MB）
- 線上狀態：看得到工作區裡誰現在也開著這個 app
- 通知中心＋ Web Push：被 @提及或被指派任務時，就算分頁關閉也收得到推播；每一類通知可以個別關閉，也可以改成收每日摘要信
- 區段與看板檢視：專案內可以分區段，切換成看板後每個區段是一欄，跟清單共用同一組排序鍵，兩邊拖曳的結果彼此一致
- 依負責人分組：清單檢視除了不分組／專案／優先度，也可以依負責人分組
- 專案範本：一鍵複製一個專案的結構（區段＋未完成任務）到新專案，不帶已完成任務、留言或到期日
- 這些全部是**選配**：不接 Supabase，或接了但沒登入，看到的都是完全正常、沒有殘缺按鈕的純本機介面
- 維運：墓碑與操作記錄每天自動清理（等所有裝置都同步過才刪，不會讓離線裝置漏看刪除事件）、單一帳號的異常寫入速率會被擋下

## 技術棧

| 套件 | 版本 | 備註 |
| --- | --- | --- |
| Vue | 3.5.41 | Composition API only，關閉 Options API 分支以減少產物 |
| Pinia | 4.0.3 | |
| Vue Router | 5.2.0 | hash 模式 |
| Vite | 8.2.1 | |
| TypeScript | ~6.0.3 | |
| Tailwind CSS | 4.3.3 | |
| idb | 8.0.3 | IndexedDB 封裝 |
| Vitest | 4.1.10 | 單元測試 |
| Playwright | 1.62.1 | E2E（含無障礙檢測） |
| ESLint | 10.8.1 | 含 vuejs-accessibility |
| @supabase/auth-js | 2.112.4 | 輕量認證模組（動態載入） |
| @supabase/realtime-js | 2.112.4 | 即時協作與 Presence 模組（動態載入） |

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

### 選配：接上跨裝置同步

不做這一段，`pnpm dev` 就是完整可用的純本地版本。

1. 到 https://supabase.com/dashboard 建一個免費專案
2. 套用資料庫遷移檔案（目前為 `0001` 至 `0030`）：
   - **推薦做法**：安裝 Supabase CLI 並連結專案後，執行 `npx supabase db push` 一鍵自動套用
   - **手動做法**：至 Supabase Dashboard 的 SQL Editor，依序貼上 [`supabase/migrations/`](supabase/migrations) 底下每個檔案執行
3. Project Settings → API，把 `Project URL` 和 `anon public` key 填進複製自
   [`.env.local.example`](.env.local.example) 的 `.env.local`
4. 啟用 Google／GitHub 登入（見下方「啟用 Google／GitHub 登入」設定 Providers 與 Redirect URLs）。目前信箱登入因免費寄件額度限制預設隱藏，改採第三方登入
5. `pnpm dev`，側邊欄會出現「登入以同步」；點擊 Google 或 GitHub 一鍵完成登入並開始同步
6. （選配）若需啟用推播通知、每日摘要信與工作區邀請信，執行以下指令部署雲端函式：
   ```sh
   npx supabase functions deploy send-task-notification --no-verify-jwt
   npx supabase functions deploy send-daily-digest --no-verify-jwt
   npx supabase functions deploy send-invitation-email
   ```

**啟用 Google／GitHub 登入**：`AccountDialog.vue` 畫面上已經有按鈕
（`OAUTH_PROVIDERS_ENABLED` 是 `true`），但按鈕能點不代表登入真的會成功——
還要在 Supabase Dashboard 那邊把對應供應商設定好，沒設定的供應商點下去
只會在畫面上看到錯誤訊息：

1. 去對應供應商的開發者主控台建立 OAuth App：

   | 供應商 | 去哪裡建立 OAuth App | Authorized redirect URI |
   | --- | --- | --- |
   | Google | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 建立 OAuth 用戶端 ID（應用程式類型選「網頁應用程式」） | `https://<your-project-ref>.supabase.co/auth/v1/callback` |
   | GitHub | GitHub → Settings → Developer settings → OAuth Apps → New OAuth App | 同上 |

2. 拿到兩邊各自的 Client ID／Client Secret 後，貼進 Supabase Dashboard 的
   **Authentication → Providers**，把 Google／GitHub 打開
3. **Google 預設只有你自己能登入**：Google Cloud Console 的 OAuth 同意畫面
   預設是 **Testing** 狀態，只有手動加進「測試使用者」名單的信箱能登入。
   要讓任何人都能用，把狀態改成 **In production**（發布）——只要求
   email／profile 這種基本權限不需要 Google 人工審查，但使用者登入時會看到
   一次「Google 未驗證此應用程式」的警告畫面，這是 Google 的預設行為，
   點「進階 → 前往（不安全）」才能繼續，不是設定錯誤
4. 同時到 **Authentication → URL Configuration**，把你本機（例如
   `http://localhost:5173`）與正式站網址都加進 **Redirect URLs** 允許
   清單——Supabase 只會導回清單裡的網址，沒加的話登入完會卡在
   Supabase 自己的頁面
