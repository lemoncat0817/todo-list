import { test, expect, type Page } from '@playwright/test'

/**
 * 擴充功能的端對端驗證：任務細節、重複規則、復原、排序、快捷鍵。
 * 這些是資料模型 v2 之後才有的能力，先前的走查測試不涵蓋。
 */

async function addTask(page: Page, name: string): Promise<void> {
  await page.getByLabel('新增代辦事項').fill(name)
  await page.getByRole('button', { name: '新增' }).click()
}

// 子任務在語意上也是清單項目，所以「main li」不再等於「一列任務」。
// data-test 標在頂層那一列上，讓計數不會把展開的子項算進來。
const rows = (page: Page) => page.locator('main li[data-test=task-row]')
const names = (page: Page) => page.locator('main [data-test=task-name]')

interface PersistedTask {
  taskName: string
  order: number
  isCompleted: boolean
  parentId: string | null
}

/**
 * 讀出 IndexedDB 裡實際落地的任務。
 *
 * 「改動後立刻重新整理」的測試必須等寫入落地，不能只等畫面更新——
 * 兩者之間有一段真實的非同步空窗（main.ts 已載明只能盡力而為），
 * 等 DOM 就重新整理等於在測時序，不是在測持久化。
 */
async function persistedTasks(page: Page): Promise<PersistedTask[]> {
  return page.evaluate(
    () =>
      new Promise<PersistedTask[]>((resolve, reject) => {
        const open = indexedDB.open('todolist')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('tasks', 'readonly')
          const req = tx.objectStore('tasks').getAll()
          req.onsuccess = () =>
            resolve((req.result as PersistedTask[]).sort((a, b) => a.order - b.order))
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

const persistedNames = async (page: Page): Promise<string[]> =>
  (await persistedTasks(page)).map((t) => t.taskName)

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  // 1280px 以上詳情是常駐右欄，以下才是對話框。這一批測的是對話框形態，
  // 所以固定在中等寬度；面板形態另有專屬測試。
  await page.setViewportSize({ width: 1100, height: 800 })
  // 「全部」是不受今天日期影響的穩定起點；「今天」檢視的行為另有測試涵蓋。
  await page.goto('/#/all')
})

test.describe('任務細節', () => {
  test('可設定優先度與到期日，並顯示為標記', async ({ page }) => {
    await addTask(page, '要設細節的')
    await page.getByRole('button', { name: /設定「要設細節的」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('優先度').selectOption('3')
    await dialog.getByLabel('到期日').fill('2030-01-15')
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(dialog).not.toBeVisible()
    await expect(rows(page).first().getByLabel('優先度：P1')).toBeVisible()
    await expect(rows(page).first()).toContainText('2030-01-15')
  })

  test('取消不會寫入變更', async ({ page }) => {
    await addTask(page, '不要改我')
    await page.getByRole('button', { name: /設定「不要改我」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('名稱', { exact: true }).fill('被改掉了')
    await dialog.getByRole('button', { name: '取消' }).click()

    await expect(names(page).first()).toHaveText('不要改我')
  })

  test('沒有到期日時時間欄位停用', async ({ page }) => {
    await addTask(page, '時間依附於日期')
    await page.getByRole('button', { name: /設定「時間依附於日期」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('時間')).toBeDisabled()
    await dialog.getByLabel('到期日').fill('2030-03-01')
    await expect(dialog.getByLabel('時間')).toBeEnabled()
  })

  test('可就地建立專案與標籤並直接套用', async ({ page }) => {
    await addTask(page, '要分類的')
    await page.getByRole('button', { name: /設定「要分類的」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('新專案名稱').fill('工作')
    await dialog.getByRole('button', { name: '建立' }).first().click()
    await dialog.getByLabel('新標籤名稱').fill('緊急')
    await dialog.getByRole('button', { name: '建立' }).last().click()
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(rows(page).first()).toContainText('工作')
    await expect(rows(page).first()).toContainText('#緊急')
  })

  test('對話框以原生 dialog 提供 Escape 關閉', async ({ page }) => {
    await addTask(page, '用 Esc 關掉')
    await page.getByRole('button', { name: /設定「用 Esc 關掉」的細節/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })
})

test.describe('寬螢幕的詳情面板', () => {
  test('1280px 以上詳情改為常駐右欄，不再用對話框蓋住清單', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await addTask(page, '在寬螢幕上編輯')

    const panel = page.getByRole('complementary', { name: '任務詳情' })
    await expect(panel, '面板一直都在，只是還沒選任務').toBeVisible()
    await expect(panel).toContainText('選一筆代辦事項')

    await page.getByRole('button', { name: /設定「在寬螢幕上編輯」的細節/ }).click()
    await expect(panel.getByLabel('名稱', { exact: true })).toHaveValue('在寬螢幕上編輯')
    // 清單沒有被蓋住，兩邊可以同時看
    await expect(rows(page).first()).toBeVisible()

    await panel.getByLabel('名稱', { exact: true }).fill('改成別的')
    await panel.getByRole('button', { name: '儲存' }).click()
    await expect(names(page).first()).toHaveText('改成別的')
  })
})

test.describe('快速新增', () => {
  test('一行寫完日期、時間、優先度、專案、標籤', async ({ page }) => {
    const input = page.getByLabel('新增代辦事項')
    await input.fill('明天下午3點 交季報 p1 #工作 @公司')

    // 送出前就看得到系統理解成什麼
    const preview = page.getByRole('status').filter({ hasText: '將建立' })
    await expect(preview).toContainText('交季報')
    await expect(preview).toContainText('P1')
    await expect(preview).toContainText('15:00')
    await expect(preview).toContainText('新專案 工作')

    await page.getByRole('button', { name: '新增' }).click()

    const row = rows(page).first()
    await expect(row.locator('[data-test=task-name]'), '語法片段不該留在名稱裡').toHaveText('交季報')
    await expect(row.getByLabel('優先度：P1')).toBeVisible()
    await expect(row).toContainText('15:00')
    await expect(row).toContainText('工作')
    await expect(row).toContainText('#公司')

    // 順手建立的專案與標籤會出現在側邊欄，成為可點的入口
    await expect(page.getByRole('link', { name: /^工作/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^#公司/ })).toBeVisible()
  })

  test('沒有語法時整句就是任務名稱', async ({ page }) => {
    await addTask(page, '買牛奶 p9 不是優先度')
    await expect(names(page).first()).toHaveText('買牛奶 p9 不是優先度')
  })
})

test.describe('子任務', () => {
  test('可新增、展開、獨立完成，並顯示進度', async ({ page }) => {
    await addTask(page, '搬家')

    const row = rows(page).first()
    await row.getByRole('button', { name: '加入「搬家」的子任務' }).click()
    const subInput = row.getByLabel('「搬家」的新子任務')
    await subInput.fill('找搬家公司')
    await subInput.press('Enter')
    // 輸入框留著，連續加第二筆不用再點一次
    await subInput.fill('打包廚房')
    await subInput.press('Enter')

    await expect(row).toContainText('子任務 0/2')
    await expect(rows(page), '子任務不佔頂層一列').toHaveCount(1)
    await expect(row).toContainText('找搬家公司')

    await row.getByLabel('標記子任務「找搬家公司」為已完成').check()
    await expect(row).toContainText('子任務 1/2')

    await expect
      .poll(async () => (await persistedTasks(page)).filter((t) => t.isCompleted).length)
      .toBe(1)
    await page.reload()
    await expect(rows(page).first()).toContainText('子任務 1/2')
  })
})

test.describe('一鍵改期', () => {
  test('不必開詳情就能改到期日', async ({ page }) => {
    await addTask(page, '要順延的')

    await rows(page).first().getByRole('button', { name: '排程「要順延的」' }).click()
    await page.getByRole('menuitem', { name: /^明天/ }).click()

    await expect(rows(page).first()).toContainText('明天')
  })
})

test.describe('重複性任務', () => {
  test('完成時推進到下一次而非消失', async ({ page }) => {
    // 名稱刻意避開「每天」：那三個字現在會被快速新增解析成重複規則，
    // 這一條要測的是從詳情設定重複，不是解析。
    await addTask(page, '固定要做的事')
    await page.getByRole('button', { name: /設定「固定要做的事」的細節/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('到期日').fill('2030-01-01')
    await dialog.getByLabel('啟用重複').check()
    await dialog.getByRole('button', { name: '儲存' }).click()

    await expect(rows(page).first()).toContainText('每天')
    await expect(rows(page).first()).toContainText('2030-01-01')

    // 勾選完成 -> 到期日推進，任務仍在未完成清單
    await rows(page).first().locator('input[type=checkbox]').check()
    await expect(rows(page).first()).toContainText('2030-01-02')
    await expect(page.getByText('未完成: 1 項')).toBeVisible()
  })
})

test.describe('復原', () => {
  test('刪除後可復原，且不再跳確認對話框', async ({ page }) => {
    await addTask(page, '刪了還能救')
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.getByRole('button', { name: '復原' }).click()
    await expect(names(page).first()).toHaveText('刪了還能救')
  })

  test('清除已完成後可復原', async ({ page }) => {
    await addTask(page, '會被清掉')
    await rows(page).first().locator('input[type=checkbox]').check()
    await page.getByRole('button', { name: '清除已完成代辦事項' }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.getByRole('button', { name: '復原' }).click()
    await expect(rows(page)).toHaveCount(1)
  })

  test('Ctrl+Z 也能復原', async ({ page }) => {
    await addTask(page, '用快捷鍵救回來')
    await rows(page).first().getByRole('button', { name: /刪除/ }).click()
    await expect(rows(page)).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect(rows(page)).toHaveCount(1)
  })
})

test.describe('排序', () => {
  test('上移／下移按鈕可調整順序，鍵盤使用者不需要拖曳', async ({ page }) => {
    for (const name of ['第一', '第二', '第三']) await addTask(page, name)
    await expect(names(page)).toHaveText(['第一', '第二', '第三'])

    await page.getByRole('button', { name: '將「第三」上移' }).click()
    await expect(names(page)).toHaveText(['第一', '第三', '第二'])

    await page.getByRole('button', { name: '將「第一」下移' }).click()
    await expect(names(page)).toHaveText(['第三', '第一', '第二'])
  })

  test('第一列不能上移，最後一列不能下移', async ({ page }) => {
    for (const name of ['甲', '乙']) await addTask(page, name)

    await expect(page.getByRole('button', { name: '將「甲」上移' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '將「乙」下移' })).toBeDisabled()
  })

  test('順序在重新整理後保留', async ({ page }) => {
    for (const name of ['A', 'B']) await addTask(page, name)
    await page.getByRole('button', { name: '將「B」上移' }).click()
    await expect(names(page)).toHaveText(['B', 'A'])
    await expect.poll(() => persistedNames(page)).toEqual(['B', 'A'])

    await page.reload()
    await expect(names(page)).toHaveText(['B', 'A'])
  })
})

test.describe('快捷鍵', () => {
  test('n 聚焦新增欄位，/ 聚焦搜尋', async ({ page }) => {
    await page.keyboard.press('n')
    await expect(page.getByLabel('新增代辦事項')).toBeFocused()

    // 聚焦在輸入框時不該攔截按鍵，否則沒辦法正常打字
    await page.keyboard.type('nnn')
    await expect(page.getByLabel('新增代辦事項')).toHaveValue('nnn')

    await page.keyboard.press('Escape')
    await page.locator('h1').click()
    await page.keyboard.press('/')
    await expect(page.getByLabel('搜尋代辦事項')).toBeFocused()
  })
})

test.describe('空狀態', () => {
  test('依情境給出不同的空狀態說明', async ({ page }) => {
    await expect(page.getByText('目前沒有代辦事項，從上方新增一筆吧')).toBeVisible()

    await addTask(page, '存在的項目')
    await page.getByRole('link', { name: /^已完成/ }).click()
    await expect(page.getByText('還沒有已完成的代辦事項')).toBeVisible()

    await page.getByRole('link', { name: /^全部/ }).click()
    await page.getByRole('button', { name: '搜尋代辦事項' }).click()
    await page.getByLabel('搜尋代辦事項').fill('找不到的東西')
    await expect(page.getByText('找不到符合「找不到的東西」的代辦事項')).toBeVisible()
  })
})

test.describe('歷史缺陷的回歸防線', () => {
  /**
   * origin/main 有一個從未合併進 master 的修正（b3924b1，2024-04）：
   * 「剛新增的代辦事項一使用編輯就立即被刪除」。
   * 當時的成因是 id 由 Date.now() 產生，同毫秒新增會碰撞，
   * 編輯時的查找因此指到別筆。現在 id 是 UUID 且編輯狀態是元件區域的，
   * 這條路徑結構上已不可能重現——留一條測試把它正式退役。
   */
  test('新增後立刻編輯不會讓項目消失', async ({ page }) => {
    await addTask(page, '剛新增的項目')
    await expect(rows(page)).toHaveCount(1)

    await rows(page).first().getByRole('button', { name: /^編輯「/ }).click()
    await page.getByRole('textbox', { name: /^編輯「/ }).fill('改過了')
    await rows(page).first().getByRole('button', { name: /^保存「/ }).click()

    await expect(rows(page), '項目仍在').toHaveCount(1)
    await expect(names(page).first()).toHaveText('改過了')
  })

  test('連續新增多筆後逐一編輯，彼此不互相影響', async ({ page }) => {
    for (const n of ['一', '二', '三']) await addTask(page, n)

    await rows(page).nth(1).getByRole('button', { name: /^編輯「/ }).click()
    await page.getByRole('textbox', { name: /^編輯「/ }).fill('第二筆改過')
    await rows(page).nth(1).getByRole('button', { name: /^保存「/ }).click()

    await expect(names(page)).toHaveText(['一', '第二筆改過', '三'])
  })
})
