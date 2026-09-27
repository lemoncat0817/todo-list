import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const OUT_DIR = path.resolve(ROOT_DIR, 'docs/screenshots')

fs.mkdirSync(OUT_DIR, { recursive: true })

async function ensureServer() {
  try {
    const res = await fetch('http://localhost:4319/')
    if (res.ok) {
      console.log('Using existing preview server on http://localhost:4319/')
      return { baseUrl: 'http://localhost:4319', server: null }
    }
  } catch {
    // server not running
  }

  console.log('Building dist bundle...')
  const build = spawn('pnpm', ['build'], { cwd: ROOT_DIR, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`Build failed: ${code}`))))
  })

  const port = 4325
  console.log(`Starting preview server on :${port}...`)
  const server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000)
    server.stdout.on('data', (d) => {
      const msg = d.toString()
      if (msg.includes(`http://localhost:${port}/`)) {
        clearTimeout(timeout)
        resolve(null)
      }
    })
    server.on('error', reject)
  })

  return { baseUrl: `http://localhost:${port}`, server }
}

async function seedData(page) {
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(now + 86400000).toISOString().slice(0, 10)
  const in3Days = new Date(now + 86400000 * 3).toISOString().slice(0, 10)
  const in5Days = new Date(now + 86400000 * 5).toISOString().slice(0, 10)
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10)

  const projects = [
    {
      id: 'proj-1',
      name: '產品開發',
      color: '#6366f1',
      rank: '0|h:',
      updatedAt: now,
      isInbox: false,
      workspaceId: null,
    },
    {
      id: 'proj-2',
      name: '個人生活',
      color: '#10b981',
      rank: '0|p:',
      updatedAt: now,
      isInbox: false,
      workspaceId: null,
    },
    {
      id: 'proj-3',
      name: '團隊運營',
      color: '#f59e0b',
      rank: '0|x:',
      updatedAt: now,
      isInbox: false,
      workspaceId: null,
    },
  ]

  const sections = [
    { id: 'sec-1', projectId: 'proj-1', name: '待處理 (Backlog)', rank: '0|h:', updatedAt: now },
    { id: 'sec-2', projectId: 'proj-1', name: '進行中 (In Progress)', rank: '0|p:', updatedAt: now },
    { id: 'sec-3', projectId: 'proj-1', name: '審查與測試 (Review)', rank: '0|x:', updatedAt: now },
    { id: 'sec-4', projectId: 'proj-1', name: '已發布 (Released)', rank: '0|z:', updatedAt: now },
  ]

  const tags = [
    { id: 'tag-1', name: '工作', color: '#3b82f6', updatedAt: now, workspaceId: null },
    { id: 'tag-2', name: '緊急', color: '#ef4444', updatedAt: now, workspaceId: null },
    { id: 'tag-3', name: '生活', color: '#10b981', updatedAt: now, workspaceId: null },
    { id: 'tag-4', name: '設計', color: '#8b5cf6', updatedAt: now, workspaceId: null },
    { id: 'tag-5', name: '學習', color: '#ec4899', updatedAt: now, workspaceId: null },
  ]

  const filters = [
    {
      id: 'fil-1',
      name: '高優先工作',
      query: 'p1 & #工作',
      color: '#ef4444',
      rank: '0|h:',
      updatedAt: now,
      workspaceId: null,
    },
    {
      id: 'fil-2',
      name: '今日待辦與逾期',
      query: 'today | overdue',
      color: '#f59e0b',
      rank: '0|p:',
      updatedAt: now,
      workspaceId: null,
    },
  ]

  const tasks = [
    {
      id: 'task-1',
      taskName: '完成 Q3 產品發表會簡報與功能 Demo',
      isCompleted: false,
      rank: '0|h:',
      priority: 3, // P1
      dueDate: today,
      dueTime: '17:00',
      projectId: 'proj-1',
      sectionId: 'sec-2',
      tagIds: ['tag-1', 'tag-2'],
      notes: '涵蓋主要功能更新展示、使用者滿意度數據回顧與下季度 Roadmap 規劃。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 24,
      updatedAt: now,
    },
    {
      id: 'sub-1',
      taskName: '統整使用者反饋指標與滿意度圖表',
      isCompleted: true,
      rank: '0|h:',
      priority: 0,
      dueDate: null,
      dueTime: null,
      projectId: null,
      sectionId: null,
      tagIds: [],
      notes: '',
      parentId: 'task-1',
      recurrence: null,
      completedAt: now - 3600000 * 3,
      createdAt: now - 3600000 * 20,
      updatedAt: now,
    },
    {
      id: 'sub-2',
      taskName: '錄製看板拖曳與篩選語法操作短片',
      isCompleted: true,
      rank: '0|p:',
      priority: 0,
      dueDate: null,
      dueTime: null,
      projectId: null,
      sectionId: null,
      tagIds: [],
      notes: '',
      parentId: 'task-1',
      recurrence: null,
      completedAt: now - 3600000 * 2,
      createdAt: now - 3600000 * 18,
      updatedAt: now,
    },
    {
      id: 'sub-3',
      taskName: '排練投影片講稿並控制發表時間在 20 分鐘內',
      isCompleted: false,
      rank: '0|x:',
      priority: 0,
      dueDate: null,
      dueTime: null,
      projectId: null,
      sectionId: null,
      tagIds: [],
      notes: '',
      parentId: 'task-1',
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 10,
      updatedAt: now,
    },
    {
      id: 'sub-4',
      taskName: '與行銷團隊同步確認社群發表排程',
      isCompleted: false,
      rank: '0|z:',
      priority: 0,
      dueDate: null,
      dueTime: null,
      projectId: null,
      sectionId: null,
      tagIds: [],
      notes: '',
      parentId: 'task-1',
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 5,
      updatedAt: now,
    },
    {
      id: 'task-2',
      taskName: '優化 IndexedDB 離線資料快取與衝突合併演算法',
      isCompleted: false,
      rank: '0|j:',
      priority: 3, // P1
      dueDate: today,
      dueTime: '18:30',
      projectId: 'proj-1',
      sectionId: 'sec-2',
      tagIds: ['tag-1', 'tag-2'],
      notes: '強化以 updatedAt 為準的最後寫入勝出機制，並完善斷網時的 tombstone 標記。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 12,
      updatedAt: now,
    },
    {
      id: 'task-3',
      taskName: '審查前端 PR #142（側邊欄收合與微互動動態）',
      isCompleted: false,
      rank: '0|l:',
      priority: 2, // P2
      dueDate: today,
      dueTime: '15:00',
      projectId: 'proj-1',
      sectionId: 'sec-3',
      tagIds: ['tag-1', 'tag-4'],
      notes: '檢驗響應式斷點與行動端原生對話框的置中對齊表現。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 8,
      updatedAt: now,
    },
    {
      id: 'task-4',
      taskName: '預訂週五團隊季末聚餐餐廳與統計出席名單',
      isCompleted: false,
      rank: '0|n:',
      priority: 2, // P2
      dueDate: today,
      dueTime: '20:00',
      projectId: 'proj-3',
      sectionId: null,
      tagIds: ['tag-3'],
      notes: '優先預訂近捷運站的包廂座位。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 6,
      updatedAt: now,
    },
    {
      id: 'task-5',
      taskName: '整理下半年雲端伺服器架構與服務預算清單',
      isCompleted: false,
      rank: '0|p:',
      priority: 1, // P3
      dueDate: tomorrow,
      dueTime: '11:00',
      projectId: 'proj-3',
      sectionId: null,
      tagIds: ['tag-1'],
      notes: '評估 CDN 流量與資料庫備份儲存費用。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 4,
      updatedAt: now,
    },
    {
      id: 'task-6',
      taskName: '閱讀 Web Performance 規範與動畫優化指南',
      isCompleted: false,
      rank: '0|r:',
      priority: 1, // P3
      dueDate: tomorrow,
      dueTime: '14:00',
      projectId: 'proj-2',
      sectionId: null,
      tagIds: ['tag-5'],
      notes: '深入理解 CSS composite layers 與 GPU 加速細節。',
      parentId: null,
      recurrence: { freq: 'weekly', interval: 1, byDay: [], byMonthDay: null, until: null, count: null },
      completedAt: null,
      createdAt: now - 3600000 * 3,
      updatedAt: now,
    },
    {
      id: 'task-7',
      taskName: '準備下週一跨部門 Sprint 規劃會議議程與議題',
      isCompleted: false,
      rank: '0|t:',
      priority: 2, // P2
      dueDate: in3Days,
      dueTime: '09:30',
      projectId: 'proj-3',
      sectionId: null,
      tagIds: ['tag-1'],
      notes: '確認各組需求優先順序與依賴關係。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 2,
      updatedAt: now,
    },
    {
      id: 'task-8',
      taskName: '採購辦公室人體工學椅與升降桌配件',
      isCompleted: false,
      rank: '0|v:',
      priority: 0, // P4
      dueDate: in5Days,
      dueTime: null,
      projectId: 'proj-3',
      sectionId: null,
      tagIds: ['tag-3'],
      notes: '申請行政採購流程。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000,
      updatedAt: now,
    },
    {
      id: 'task-9',
      taskName: '回覆客戶技術支援諮詢信件與問題排查',
      isCompleted: false,
      rank: '0|x:',
      priority: 2, // P2
      dueDate: yesterday,
      dueTime: '16:00',
      projectId: 'proj-1',
      sectionId: 'sec-1',
      tagIds: ['tag-1', 'tag-2'],
      notes: '確認跨瀏覽器相容性與使用者回報之狀況。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 30,
      updatedAt: now,
    },
    {
      id: 'task-10',
      taskName: '評估 Web Worker 背景資料同步效能與記憶體佔用',
      isCompleted: false,
      rank: '0|y:',
      priority: 2, // P2
      dueDate: tomorrow,
      dueTime: '16:30',
      projectId: 'proj-1',
      sectionId: 'sec-1',
      tagIds: ['tag-1'],
      notes: '測試大量任務批次寫入時主執行緒之流暢度。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 20,
      updatedAt: now,
    },
    {
      id: 'task-11',
      taskName: '整合 Playwright 視覺回歸測試至 GitHub Actions CI',
      isCompleted: false,
      rank: '0|z:',
      priority: 3, // P1
      dueDate: in3Days,
      dueTime: '18:00',
      projectId: 'proj-1',
      sectionId: 'sec-4',
      tagIds: ['tag-1', 'tag-4'],
      notes: '自動化驗證各斷點排版與深淺色模式渲染。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 15,
      updatedAt: now,
    },
    {
      id: 'task-12',
      taskName: '探索離線語音快速輸入與自然語言指令解析',
      isCompleted: false,
      rank: '0|za:',
      priority: 1, // P3
      dueDate: in5Days,
      dueTime: null,
      projectId: 'proj-1',
      sectionId: null,
      tagIds: ['tag-4', 'tag-5'],
      notes: '實驗 Web Speech API 在行動端之支援度。',
      parentId: null,
      recurrence: null,
      completedAt: null,
      createdAt: now - 3600000 * 10,
      updatedAt: now,
    },
  ]

  // Completed tasks for stats (14 days trend)
  const completedSamples = [
    { name: '更新登入頁 PKCE 驗證流程與錯誤提示', daysAgo: 0, hoursAgo: 2, proj: 'proj-1' },
    { name: '發布 2.4.0 穩定版 Release Notes', daysAgo: 0, hoursAgo: 4, proj: 'proj-1' },
    { name: '建立 GitHub Actions 自動部署工作流', daysAgo: 0, hoursAgo: 6, proj: 'proj-1' },
    { name: '整理每週團隊站立會議追蹤清單', daysAgo: 1, hoursAgo: 10, proj: 'proj-3' },
    { name: '修復行動端橫向捲動溢出問題', daysAgo: 1, hoursAgo: 15, proj: 'proj-1' },
    { name: '撰寫自然語言快速新增單元測試', daysAgo: 2, hoursAgo: 8, proj: 'proj-1' },
    { name: '升級 Tailwind CSS 至 4.3 版本', daysAgo: 2, hoursAgo: 14, proj: 'proj-1' },
    { name: '重構 Pinia 狀態模組拆分', daysAgo: 2, hoursAgo: 18, proj: 'proj-1' },
    { name: '購置居家工作人體工學滑鼠', daysAgo: 3, hoursAgo: 12, proj: 'proj-2' },
    { name: '閱讀 Vue 3.5 核心響應式更新文檔', daysAgo: 4, hoursAgo: 16, proj: 'proj-2' },
    { name: '設計深色模式色彩對比度配方', daysAgo: 4, hoursAgo: 20, proj: 'proj-1' },
    { name: '統整 Q2 雲端主機花費與效益分析', daysAgo: 5, hoursAgo: 11, proj: 'proj-3' },
    { name: '執行 Playwright 端對端測試並修復 flaky 案例', daysAgo: 6, hoursAgo: 9, proj: 'proj-1' },
    { name: '安排例行健康檢查預約', daysAgo: 7, hoursAgo: 14, proj: 'proj-2' },
    { name: '重構任務詳情表單元件聚焦管理', daysAgo: 8, hoursAgo: 16, proj: 'proj-1' },
    { name: '清理冗餘套件依賴與 gzip 體積瘦身', daysAgo: 10, hoursAgo: 10, proj: 'proj-1' },
    { name: '訂閱前端技術電子報與週刊', daysAgo: 12, hoursAgo: 15, proj: 'proj-2' },
    { name: '設定團隊工作區共享權限規則', daysAgo: 13, hoursAgo: 17, proj: 'proj-3' },
  ]

  completedSamples.forEach((s, idx) => {
    const compTime = now - s.daysAgo * 86400000 - s.hoursAgo * 3600000
    tasks.push({
      id: `comp-${idx + 1}`,
      taskName: s.name,
      isCompleted: true,
      rank: `0|c${idx}:`,
      priority: 1,
      dueDate: new Date(compTime).toISOString().slice(0, 10),
      dueTime: '17:00',
      projectId: s.proj,
      sectionId: null,
      tagIds: ['tag-1'],
      notes: '',
      parentId: null,
      recurrence: null,
      completedAt: compTime,
      createdAt: compTime - 86400000,
      updatedAt: compTime,
    })
  })

  // Inject into IndexedDB
  await page.evaluate(
    async ({ projects, sections, tags, filters, tasks }) => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('todolist')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['projects', 'sections', 'tags', 'filters', 'tasks'], 'readwrite')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)

          // Clear existing
          tx.objectStore('projects').clear()
          tx.objectStore('sections').clear()
          tx.objectStore('tags').clear()
          tx.objectStore('filters').clear()
          tx.objectStore('tasks').clear()

          // Add records
          for (const p of projects) tx.objectStore('projects').add(p)
          for (const s of sections) tx.objectStore('sections').add(s)
          for (const t of tags) tx.objectStore('tags').add(t)
          for (const f of filters) tx.objectStore('filters').add(f)
          for (const task of tasks) tx.objectStore('tasks').add(task)
        }
      })
    },
    { projects, sections, tags, filters, tasks },
  )
}

async function run() {
  const { baseUrl, server } = await ensureServer()
  const browser = await chromium.launch()

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    // 1. Visit to let main.ts boot and init DB
    await page.goto(`${baseUrl}/#/all`)
    await page.waitForTimeout(1000)

    // 2. Seed realistic data
    console.log('Seeding rich demonstration data...')
    await seedData(page)
    await page.reload()
    await page.waitForSelector('main li')
    console.log('Data loaded successfully!')

    // --- 01-task-overview.png (Light Mode) ---
    console.log('Capturing 01-task-overview.png (Light Mode)...')
    await page.evaluate(() => {
      localStorage.setItem('todoTask:theme', 'light')
      document.documentElement.classList.remove('dark')
    })
    await page.goto(`${baseUrl}/#/today`)
    await page.waitForSelector('main li')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '01-task-overview.png') })

    // --- 01-task-overview-dark.png (Dark Mode) ---
    console.log('Capturing 01-task-overview-dark.png (Dark Mode)...')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => {
      localStorage.setItem('todoTask:theme', 'dark')
      document.documentElement.classList.add('dark')
    })
    await page.reload()
    await page.waitForSelector('main li')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '01-task-overview-dark.png') })

    // Switch back to light mode for subsequent screenshots
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => {
      localStorage.setItem('todoTask:theme', 'light')
      document.documentElement.classList.remove('dark')
    })
    await page.reload()
    await page.waitForSelector('main li')

    // --- 02-task-detail.png ---
    console.log('Capturing 02-task-detail.png (Task Detail with Subtasks)...')
    await page.goto(`${baseUrl}/#/all`)
    await page.waitForSelector('main li')
    // Expand subtasks in main list as well
    const expandBtn = page.locator('[data-task-id="task-1"]').getByRole('button', { name: /^展開「.*」的子任務/ })
    if (await expandBtn.isVisible()) {
      await expandBtn.click()
    }
    // Click task-1 detail button (with force: true to bypass hover fade)
    await page.locator('[data-task-id="task-1"]').getByRole('button', { name: /設定「.*」的細節/ }).click({ force: true })
    await page.waitForSelector('aside[aria-label="任務詳情"] form', { timeout: 5000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '02-task-detail.png') })

    // Close detail panel and collapse it for wide views
    const closeDetailBtn = page.getByRole('button', { name: '關閉任務詳情' })
    if (await closeDetailBtn.isVisible()) {
      await closeDetailBtn.click()
    }
    await page.waitForTimeout(200)
    const collapseDetailBtn = page.getByRole('button', { name: '收合任務詳情' })
    if (await collapseDetailBtn.isVisible()) {
      await collapseDetailBtn.click()
    }
    await page.waitForTimeout(300)

    // --- 03-board-view.png ---
    console.log('Capturing 03-board-view.png (Project Kanban Board)...')
    await page.goto(`${baseUrl}/#/project/proj-1`)
    await page.waitForTimeout(500)
    // Toggle board mode if not already
    const toggleBoardBtn = page.getByRole('button', { name: '切換為看板' })
    if (await toggleBoardBtn.isVisible()) {
      await toggleBoardBtn.click()
    }
    await page.waitForSelector('section h2')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '03-board-view.png') })

    // --- 04-upcoming-view.png ---
    console.log('Capturing 04-upcoming-view.png (Upcoming Timeline View)...')
    await page.goto(`${baseUrl}/#/upcoming`)
    await page.waitForSelector('main section')
    const collapseTask1Btn = page.locator('[data-task-id="task-1"]').getByRole('button', { name: /^收合「.*」的子任務/ })
    if (await collapseTask1Btn.isVisible()) {
      await collapseTask1Btn.click()
    }
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '04-upcoming-view.png') })

    // --- 05-collections-management.png ---
    console.log('Capturing 05-collections-management.png (Projects & Tags Management)...')
    await page.goto(`${baseUrl}/#/all`)
    await page.waitForSelector('main li')
    // Click manage projects button
    await page.getByRole('button', { name: '管理專案與標籤' }).first().click()
    await page.waitForSelector('dialog[open]')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '05-collections-management.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // --- 06-filter-query.png ---
    console.log('Capturing 06-filter-query.png (Advanced Filter Query Language)...')
    const filterQuery = encodeURIComponent('today & (p1 | p2)')
    await page.goto(`${baseUrl}/#/filter?q=${filterQuery}`)
    await page.waitForSelector('main li')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '06-filter-query.png') })

    // --- 07-command-palette.png ---
    console.log('Capturing 07-command-palette.png (Command Palette Cmd+K)...')
    await page.goto(`${baseUrl}/#/all`)
    await page.waitForSelector('main li')
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })
    await page.waitForSelector('dialog[open] input[role="combobox"]')
    await page.locator('dialog[open] input[role="combobox"]').fill('工作')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '07-command-palette.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // --- 08-productivity-stats.png ---
    console.log('Capturing 08-productivity-stats.png (Productivity Analytics & Stats)...')
    await page.goto(`${baseUrl}/#/stats`)
    await page.waitForSelector('ol li')
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, '08-productivity-stats.png') })

    console.log('All screenshots captured successfully!')
  } finally {
    await browser.close()
    server?.kill()
  }
}

run().catch((err) => {
  console.error('Error during capture:', err)
  process.exit(1)
})
