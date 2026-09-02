import { defineStore } from 'pinia'
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { applyTaskChanges, enqueueOp, loadTasks, migrateFromLocalStorage } from '@/db'
import type {
  Op,
  Priority,
  Recurrence,
  StoredFilter,
  StoredProject,
  StoredTag,
  StoredTask,
} from '@/db/schema'
import { createTask, groupByParent } from '@/domain/task'
import { diffAgainstFingerprint, diffFields } from '@/domain/diff'
import { mergeById } from '@/db/backup'
import { nextOccurrence } from '@/domain/recurrence'
import { nextOrder, orderBetween, sortByOrder } from '@/domain/ordering'
import { countByFilter, queryTasks, type TaskFilter, type TaskQuery } from '@/domain/filtering'
import {
  overdueCount,
  resolveView,
  viewCount,
  type TaskGroup,
  type ViewOptions,
  type ViewSpec,
} from '@/domain/views'
import { compileFilter } from '@/domain/filterQuery'
import { isSyncConfigured } from '@/sync/config'
import { toRemoteTask } from '@/sync/rowMapping'
import { usePrefsStore } from './prefs'
import { useHistoryStore } from './history'
import { useCollectionsStore } from './collections'
import { useUiStore } from './ui'

/**
 * 本地寫入成功後，把這次真的變了的欄位排進離線操作佇列，供
 * stores/sync.ts 之後送給 apply_task_patch／create_task RPC。
 *
 * 不是在 add()／update()／toggle()／batchUpdate()……每個變更方法各自
 * 插入——那需要在十幾個呼叫點各自組出正確的補丁內容，任何一處漏掉或
 * 組錯都不會被既有測試發現。這裡改成集中在 flush() 已經在算的
 * diffAgainstFingerprint 結果上再算一次「哪些欄位真的變了」：
 * upserts 是「這一列的內容跟上次存的不一樣」，`persistedIndex` 記著
 * 上次存的完整內容，兩者一比就能拿到欄位級的差異，且不管變更是來自
 * 使用者操作、undo/redo、匯入、還是批次操作都一體適用——它們最終
 * 都只是把 items.value 改成某個新狀態，watcher 本來就會觸發 flush()。
 *
 * 只處理 tasks；projects/tags/filters 目前仍走 stores/sync.ts 舊版的
 * 指紋比對＋整列 upsert（collections.ts 的 flush() 是整份覆寫，沒有
 * 這裡用得到的逐列本地指紋）。等 collections 也搬到 outbox 才會統一。
 *
 * `excludeIds` 是 mergeRemote() 記下的「這次是遠端合併動到的」id——見
 * mergeRemote() 與 remoteMergedIds 的說明，這裡收到就直接跳過，不然
 * 剛拉回來的資料會被當成本地變更又推一次回去，形成自我循環。
 */
async function enqueueSyncOps(
  upserts: readonly StoredTask[],
  deletes: readonly string[],
  previousIndex: ReadonlyMap<string, string>,
  excludeIds: ReadonlySet<string>,
): Promise<void> {
  const now = Date.now()
  const ops: Op[] = []

  for (const row of upserts) {
    if (excludeIds.has(row.id)) continue
    const previousJson = previousIndex.get(row.id)
    const before = previousJson ? toRemoteTask(JSON.parse(previousJson) as StoredTask) : null
    const patch = diffFields(before, toRemoteTask(row))
    if (Object.keys(patch).length === 0) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: before === null ? 'task.create' : 'task.patch',
      targetId: row.id,
      payload: patch,
      createdAt: now,
      attempts: 0,
    })
  }

  for (const id of deletes) {
    if (excludeIds.has(id)) continue
    ops.push({
      id: crypto.randomUUID(),
      kind: 'task.delete',
      targetId: id,
      payload: { deleted_at: now },
      createdAt: now,
      attempts: 0,
    })
  }

  for (const op of ops) await enqueueOp(op)
}

/**
 * 任務本體。
 *
 * 這個 store 只管任務：專案與標籤在 collections、復原在 history、
 * 搜尋與主題偏好在 ui。先前全部擠在一個 450 行的 store 裡，
 * 任何一項改動都得碰同一個檔案。
 *
 * 篩選與排序都委派給 domain 的純函式，這裡只做狀態編排與持久化。
 */
export const useTasksStore = defineStore('tasks', () => {
  const items = ref<StoredTask[]>([])

  /** 資料由 IndexedDB 非同步載入，載入期間畫面需要能表達「還在讀」。 */
  const isLoading = ref(true)
  /** 載入失敗：清單真的取不到，畫面應改為錯誤狀態。 */
  const loadError = ref<unknown>(null)
  /**
   * 寫入失敗：資料仍在記憶體、清單照常可用，只是沒存下去。
   * 刻意與 loadError 分開——混為一談會讓一次存檔失敗就整份清單消失。
   */
  const writeError = ref<unknown>(null)
  const migration = ref<{ migrated: number; skipped: number } | null>(null)

  const history = useHistoryStore()
  const collections = useCollectionsStore()
  const ui = useUiStore()
  const prefs = usePrefsStore()

  // ------------------------------------------------------------ 查詢

  /** 目前搜尋條件下的可見任務，供畫面與計數共用同一條路徑。 */
  const visible = computed(() => (filter: TaskFilter) =>
    queryTasks(items.value, { keyword: ui.keyword, filter }),
  )

  const counts = computed(() => countByFilter(items.value, { keyword: ui.keyword }))

  /**
   * 組出 resolveView 的選項。
   *
   * filter 檢視要在這裡把查詢字串編譯成述詞：編譯失敗時傳 null，
   * resolveView 會回傳空清單，畫面才有辦法區分「查詢寫錯」與「沒有結果」。
   *
   * 用條件展開而非直接指派 undefined：tsconfig 開了 exactOptionalPropertyTypes，
   * 「不設這個屬性」與「設成 undefined」是兩件事。
   */
  function viewOptions(spec: ViewSpec, extra: ViewOptions = {}): ViewOptions {
    const base: ViewOptions = { ...extra }
    if (spec.kind === 'filter') {
      base.predicate = compileFilter(spec.id ?? '', {
        projects: collections.projects,
        tags: collections.tags,
      })
    }
    return base
  }

  /**
   * 檢視的分組結果。清單本體與側邊欄徽章都走這條路徑（domain/views），
   * 沿用「一條路徑」的規矩——數字與內容不可能對不上。
   */
  const groupsOf = computed(
    () =>
      (spec: ViewSpec): TaskGroup[] =>
        resolveView(
          items.value,
          spec,
          viewOptions(spec, {
            keyword: ui.keyword,
            sort: prefs.sortBy,
            groupBy: prefs.groupBy,
            projects: collections.projects,
          }),
        ),
  )

  /** 側邊欄徽章：刻意不套關鍵字，搜尋中仍要看得到各入口的真實數量。 */
  const countOf = computed(
    () =>
      (spec: ViewSpec): number =>
        viewCount(items.value, spec, viewOptions(spec)),
  )

  const overdue = computed(() => overdueCount(items.value))

  /**
   * 子任務索引：parentId → 依序排好的子項。
   *
   * 一次算好整張表而不是每列各自 filter：清單有 N 列時，後者是 N² 次掃描。
   */
  const childrenByParent = computed(() => groupByParent(items.value))

  function childrenOf(parentId: string): StoredTask[] {
    return childrenByParent.value.get(parentId) ?? []
  }

  const remaining = computed(() => items.value.filter((t) => !t.isCompleted).length)

  function query(q: TaskQuery = {}): StoredTask[] {
    return queryTasks(items.value, { keyword: ui.keyword, ...q })
  }

  // ------------------------------------------------------------ 持久化

  let inFlight: Promise<void> | null = null
  let dirty = false
  /** 載入期間為 true；watcher 是非同步的，不能只靠 isLoading 判斷。 */
  let hydrating = false

  /**
   * 實測抓到的缺陷：`recurrence` 是任務裡唯一的巢狀物件欄位，`tagIds` 一直有
   * 明確淺拷貝，`recurrence` 之前沒有——它會從 TaskDetailForm 的 `draft`（一個
   * ref）一路帶著 Vue 的 reactive Proxy 流進來（`{ ...toRaw(t) }` 只淺層展開，
   * 不會把巢狀屬性也 toRaw），最後整包丟給 IndexedDB 的 `put()`。
   * structured clone 認不得 Proxy，會直接丟 DataCloneError，
   * 使用者看到的就是「變更尚未存檔」——跟儲存空間滿不滿全無關係。
   */
  function snapshot(): StoredTask[] {
    return toRaw(items.value).map((t) => ({
      ...toRaw(t),
      tagIds: [...t.tagIds],
      recurrence: t.recurrence ? { ...t.recurrence, byDay: [...t.recurrence.byDay] } : null,
    }))
  }

  /**
   * 上一次成功寫入的內容指紋（id → JSON）。
   *
   * 用來算出「這次真的變了哪幾列」，只寫那幾列。先前每次變更都是
   * clear() 再重寫整張表，上千筆時每打一個勾都要付整表的成本。
   *
   * 比對整串 JSON 而不是只看 updatedAt：復原會把舊物件放回去，
   * 那時 updatedAt 反而是「比較舊」的，只看時間戳會漏掉這種變更。
   * 序列化幾百個小物件是毫秒等級，真正貴的是 IndexedDB 的寫入。
   */
  let persistedIndex = new Map<string, string>()

  /**
   * 這次 flush() 之前，最近一次 mergeRemote() 動到的 id 集合——這些列的
   * 新內容本來就是從伺服器拉回來的，不該被 flush() 誤判成「本地剛編輯」
   * 又排一筆補丁推回去。這正是 stores/sync.ts 已經修過一次的「自我循環」
   * 問題的翻版：mergeRemote 寫回 items.value 後，內容跟 persistedIndex
   * 不一樣（因為還沒真的存進本地 IndexedDB），單看內容差異完全沒辦法
   * 分辨「使用者剛打的字」跟「剛從遠端合併回來的資料」，只能在
   * mergeRemote() 呼叫當下明確記一筆「這是遠端來的」。
   *
   * 每次 flush() 消費後清空：只抑制「緊接在這次合併之後的那次 flush」，
   * 不是永久排除這個 id——這些列之後如果被使用者真的編輯，還是要能正常
   * 產生補丁。
   */
  let remoteMergedIds = new Set<string>()

  /**
   * 回傳的 Promise 一定在資料真的寫完時才 resolve，即使呼叫時已有寫入在進行中。
   * 不做延遲防抖：那會讓「操作後立刻重新整理」出現丟資料的空窗。
   */
  function flush(): Promise<void> {
    if (inFlight) {
      dirty = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          dirty = false
          const { upserts, deletes, nextFingerprint } = diffAgainstFingerprint(snapshot(), persistedIndex)

          await applyTaskChanges({ upserts, deletes })
          if (isSyncConfigured) await enqueueSyncOps(upserts, deletes, persistedIndex, remoteMergedIds)
          remoteMergedIds = new Set()
          await collections.flush()
          // 寫成功之後才更新指紋：失敗時保持原狀，下一次會重試同一批
          persistedIndex = nextFingerprint
        } while (dirty)
        writeError.value = null
      } catch (error) {
        // 畫面只給「變更尚未存檔」這種不點名成因的通用訊息（稽核既有慣例，
        // 見 stores/sync.ts 的 describeSyncError）；真正的錯誤內容留在
        // console，不然像 DataCloneError 這種能一眼看出根因的線索就白白遺失。
        console.error('[tasks] 寫入失敗', error)
        writeError.value = error
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function init(): Promise<void> {
    hydrating = true
    isLoading.value = true
    loadError.value = null
    try {
      const result = await migrateFromLocalStorage()
      if (result.ran) migration.value = { migrated: result.migrated, skipped: result.skipped }
      items.value = await loadTasks()
      // 剛讀進來的內容就是資料庫裡的內容，先記下指紋，
      // 否則第一次 flush 會把每一列都當成新的而重寫一遍
      persistedIndex = new Map(snapshot().map((t) => [t.id, JSON.stringify(t)]))
      await collections.load()
    } catch (error) {
      loadError.value = error
    } finally {
      isLoading.value = false
    }
    // watcher 以 pre flush 非同步執行；等它跑過這一輪再解除保護，
    // 否則載入本身會觸發一次多餘的回寫。
    await nextTick()
    hydrating = false
  }

  watch(
    // filters 曾經漏在這份清單外——單獨新增／改名／刪除一個篩選器不會觸發
    // flush()，要等任務或專案／標籤也剛好變動才會連帶存進去。
    [items, () => collections.projects, () => collections.tags, () => collections.filters],
    () => {
      if (hydrating) return
      void flush()
    },
    { deep: true },
  )

  // ---------------------------------------------------------- 任務 CRUD

  const indexOf = (id: string) => items.value.findIndex((t) => t.id === id)

  function add(taskName: string, overrides: Partial<StoredTask> = {}): StoredTask {
    const task = createTask(taskName, nextOrder(items.value), overrides)
    items.value.push(task)
    history.record({
      label: `新增「${taskName}」`,
      undo: () => {
        items.value = items.value.filter((t) => t.id !== task.id)
      },
      redo: () => {
        items.value.push(task)
      },
    })
    return task
  }

  /**
   * 新增子任務。
   *
   * 只支援一層：父項本身有 parentId 時直接拒絕。無限層級對待辦工具是過度設計，
   * 而且會帶來循環參照的風險（domain/task.ts 的 groupByParent 也是照這個前提寫的）。
   * 子項預設繼承父項的專案——分類是父項的屬性，子項另外分類只會讓清單更難讀。
   */
  function addSubtask(parentId: string, taskName: string): StoredTask | null {
    const parent = items.value.find((t) => t.id === parentId)
    if (!parent || parent.parentId !== null) return null

    const task = createTask(taskName, nextOrder(childrenOf(parentId)), {
      parentId,
      projectId: parent.projectId,
    })
    items.value.push(task)
    history.record({
      label: `新增子任務「${taskName}」`,
      undo: () => {
        items.value = items.value.filter((t) => t.id !== task.id)
      },
      redo: () => {
        items.value.push(task)
      },
    })
    return task
  }

  function update(id: string, patch: Partial<StoredTask>): void {
    const index = indexOf(id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredTask) }
    const after = { ...before, ...patch, updatedAt: Date.now() }
    items.value[index] = after
    history.record({
      label: `修改「${before.taskName}」`,
      undo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  /** 刪除任務，連同其子任務。 */
  function remove(id: string): void {
    const target = items.value.find((t) => t.id === id)
    if (!target) return
    const removed = items.value.filter((t) => t.id === id || t.parentId === id).map((t) => ({ ...t }))
    items.value = items.value.filter((t) => t.id !== id && t.parentId !== id)
    history.record({
      label:
        removed.length > 1
          ? `刪除「${target.taskName}」與 ${removed.length - 1} 個子項`
          : `刪除「${target.taskName}」`,
      undo: () => {
        items.value = sortByOrder([...items.value, ...removed])
      },
      redo: () => {
        items.value = items.value.filter((t) => t.id !== id && t.parentId !== id)
      },
    })
  }

  function clearCompleted(): void {
    const removed = items.value.filter((t) => t.isCompleted).map((t) => ({ ...t }))
    if (removed.length === 0) return
    items.value = items.value.filter((t) => !t.isCompleted)
    history.record({
      label: `清除 ${removed.length} 項已完成`,
      undo: () => {
        items.value = sortByOrder([...items.value, ...removed])
      },
      redo: () => {
        items.value = items.value.filter((t) => !t.isCompleted)
      },
    })
  }

  /**
   * 切換完成狀態。
   *
   * 重複性任務在「完成」時不是消失，而是把到期日推進到下一次發生日並保持未完成——
   * 這就是「完成時才展開」，不預先產生無限筆。
   * 規則結束（超過 until 或 count 用盡）時才真正標記完成。
   */
  function toggle(id: string): void {
    const index = indexOf(id)
    if (index === -1) return
    const before = { ...(items.value[index] as StoredTask) }

    if (!before.isCompleted && before.recurrence && before.dueDate) {
      const next = nextOccurrence(before.recurrence, before.dueDate)
      if (next !== null) {
        const advanced = { ...before, dueDate: next, updatedAt: Date.now() }
        items.value[index] = advanced
        history.record({
          label: `完成「${before.taskName}」，下次 ${next}`,
          undo: () => {
            const i = indexOf(id)
            if (i !== -1) items.value[i] = before
          },
          redo: () => {
            const i = indexOf(id)
            if (i !== -1) items.value[i] = advanced
          },
        })
        return
      }
    }

    const now = Date.now()
    const after = {
      ...before,
      isCompleted: !before.isCompleted,
      completedAt: before.isCompleted ? null : now,
      updatedAt: now,
    }
    items.value[index] = after
    history.record({
      label: `${after.isCompleted ? '完成' : '取消完成'}「${before.taskName}」`,
      undo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = before
      },
      redo: () => {
        const i = indexOf(id)
        if (i !== -1) items.value[i] = after
      },
    })
  }

  /** 拖曳／鍵盤排序：把 id 移到 targetId 之前或之後。 */
  function move(id: string, targetId: string, position: 'before' | 'after'): void {
    const moving = items.value.find((t) => t.id === id)
    const target = items.value.find((t) => t.id === targetId)
    if (!moving || !target || id === targetId) return

    const sorted = sortByOrder(items.value)
    const targetIndex = sorted.findIndex((t) => t.id === targetId)
    const neighbour = sorted[position === 'before' ? targetIndex - 1 : targetIndex + 1] ?? null

    const previousOrder = moving.order
    // 取中間值而非重編號：一次拖曳只需寫入一列
    moving.order =
      position === 'before'
        ? orderBetween(neighbour?.order ?? null, target.order)
        : orderBetween(target.order, neighbour?.order ?? null)
    moving.updatedAt = Date.now()

    history.record({
      label: `移動「${moving.taskName}」`,
      undo: () => {
        const t = items.value.find((x) => x.id === id)
        if (t) t.order = previousOrder
      },
    })
  }

  function setPriority(id: string, priority: Priority): void {
    update(id, { priority })
  }

  /**
   * 改期。清掉日期時一併清掉時間——沒有日期的時間沒有意義，
   * 這條規則在 normalizeTask 與 quickAdd 都成立，這裡不能是例外。
   */
  function reschedule(id: string, dueDate: string | null): void {
    update(id, dueDate === null ? { dueDate: null, dueTime: null } : { dueDate })
  }

  function setRecurrence(id: string, recurrence: Recurrence | null): void {
    update(id, { recurrence })
  }

  function toggleTag(taskId: string, tagId: string): void {
    const task = items.value.find((t) => t.id === taskId)
    if (!task) return
    update(taskId, {
      tagIds: task.tagIds.includes(tagId)
        ? task.tagIds.filter((t) => t !== tagId)
        : [...task.tagIds, tagId],
    })
  }

  // ------------------------------------------------------------ 批次操作

  /**
   * 一次改多筆。
   *
   * 整批只推一個 undo command，不是每筆一個：使用者按一次「全部順延到明天」
   * 是一個決定，復原時也該一次回到原狀。二十筆各推一個的話，
   * 要按二十次 Ctrl+Z 才回得去——那等於沒有復原。
   */
  function batchUpdate(ids: readonly string[], patch: Partial<StoredTask>, label: string): number {
    const targets = new Set(ids)
    const before = items.value.filter((t) => targets.has(t.id)).map((t) => ({ ...t }))
    if (before.length === 0) return 0

    const now = Date.now()
    items.value = items.value.map((t) =>
      targets.has(t.id) ? { ...t, ...patch, updatedAt: now } : t,
    )
    const after = items.value.filter((t) => targets.has(t.id)).map((t) => ({ ...t }))

    const restore = (snapshot: StoredTask[]) => () => {
      const byId = new Map(snapshot.map((t) => [t.id, t]))
      items.value = items.value.map((t) => byId.get(t.id) ?? t)
    }

    history.record({
      label: `${label}（${before.length} 項）`,
      undo: restore(before),
      redo: restore(after),
    })
    return before.length
  }

  /** 批次刪除，連同各自的子項；同樣只推一個 command。 */
  function batchRemove(ids: readonly string[]): number {
    const targets = new Set(ids)
    const removed = items.value
      .filter((t) => targets.has(t.id) || (t.parentId !== null && targets.has(t.parentId)))
      .map((t) => ({ ...t }))
    if (removed.length === 0) return 0

    const removedIds = new Set(removed.map((t) => t.id))
    const drop = () => {
      items.value = items.value.filter((t) => !removedIds.has(t.id))
    }
    drop()

    history.record({
      label: `刪除 ${ids.length} 項`,
      undo: () => {
        items.value = sortByOrder([...items.value, ...removed])
      },
      redo: drop,
    })
    return removed.length
  }

  /**
   * 批次完成／取消完成。取代舊的「全部標記為完成」——那顆按鈕動的是
   * 全部任務（不分專案、不分視圖），跟使用者當下看到的畫面對不上；
   * 這裡改成跟其他批次操作一樣，只作用在使用者親自選取的幾筆。
   *
   * 完成邏輯與單筆 toggle() 一致：有重複規則且未完成的任務，完成時是推進到
   * 下一次發生日、保持未完成，不是直接標記完成——重複任務的語意不能因為
   * 走的是批次路徑就不一樣。取消完成則單純，不涉及推進日期。
   * 跟 batchUpdate 一樣整批只推一個 undo command。
   */
  function batchComplete(ids: readonly string[], value: boolean): number {
    const targets = new Set(ids)
    const before = items.value.filter((t) => targets.has(t.id)).map((t) => ({ ...t }))
    if (before.length === 0) return 0

    const now = Date.now()
    items.value = items.value.map((t) => {
      if (!targets.has(t.id)) return t
      if (value && !t.isCompleted && t.recurrence && t.dueDate) {
        const next = nextOccurrence(t.recurrence, t.dueDate)
        if (next !== null) return { ...t, dueDate: next, updatedAt: now }
      }
      return { ...t, isCompleted: value, completedAt: value ? now : null, updatedAt: now }
    })
    const after = items.value.filter((t) => targets.has(t.id)).map((t) => ({ ...t }))

    const restore = (snapshot: StoredTask[]) => () => {
      const byId = new Map(snapshot.map((t) => [t.id, t]))
      items.value = items.value.map((t) => byId.get(t.id) ?? t)
    }

    history.record({
      label: `${value ? '標記完成' : '取消完成'}（${before.length} 項）`,
      undo: restore(before),
      redo: restore(after),
    })
    return before.length
  }

  /** 批次改期。與單筆 reschedule 一致：清掉日期時一併清掉時間。 */
  function batchReschedule(ids: readonly string[], dueDate: string | null): number {
    return batchUpdate(
      ids,
      dueDate === null ? { dueDate: null, dueTime: null } : { dueDate },
      dueDate === null ? '清除到期日' : `改期至 ${dueDate}`,
    )
  }

  // ------------------------------------------------------------ 匯入

  /**
   * 匯入備份。
   *
   * 整份匯入只推一個 undo command：使用者選錯檔案或選錯模式時，
   * 一次 Ctrl+Z 就該回到原狀。這是「取代」模式敢存在的前提。
   *
   * 呼叫端負責把外部資料先過 parseBackup（也就是既有的 normalize* 路徑），
   * 這裡收到的已經是合法的形狀。
   */
  function importBackup(
    data: {
      tasks: readonly StoredTask[]
      projects: readonly StoredProject[]
      tags: readonly StoredTag[]
      filters: readonly StoredFilter[]
    },
    mode: 'merge' | 'replace' = 'merge',
  ): void {
    const beforeTasks = snapshot()
    const beforeCollections = collections.snapshot()

    items.value =
      mode === 'replace' ? [...data.tasks] : sortByOrder(mergeById(beforeTasks, data.tasks))
    collections.applyImport(data, mode)

    history.record({
      label: `匯入 ${data.tasks.length} 筆任務`,
      undo: () => {
        items.value = beforeTasks
        collections.restoreSnapshot(beforeCollections)
      },
    })
  }

  // ------------------------------------------------------------ 跨裝置同步

  /**
   * 套用跨裝置同步的合併結果。
   *
   * 刻意不經過 history.record——遠端合併不是這台裝置的使用者剛做的動作，
   * 推進復原堆疊會讓人「復原」到一個不上不下的狀態（跟 init() 載入資料
   * 不記錄復原是同一個道理）。合併規則在 sync/merge.ts，這裡只負責寫回。
   */
  function mergeRemote(rows: readonly StoredTask[]): void {
    // 聯集「合併前」與「合併後」的 id：前者涵蓋這次合併把某些列拿掉
    // （遠端刪除）、後者涵蓋新增或內容變動——下一次 flush() 靠這份集合
    // 判斷哪些 upserts／deletes 是這次合併造成的，不是使用者剛做的操作，
    // 不該被誤判成本地變更又推一次到伺服器（見上面 remoteMergedIds 的說明）。
    remoteMergedIds = new Set([...items.value.map((t) => t.id), ...rows.map((t) => t.id)])
    items.value = sortByOrder(rows)
  }

  // -------------------------------------------- 跨 store 的關聯處理

  /**
   * 刪除專案。
   *
   * 預設把底下的任務移到「未分類」而不是一併刪除——刪專案是組織動作，
   * 不該把使用者的工作內容一起帶走。要連任務一起刪必須明確指定。
   *
   * 這個動作橫跨兩個 store，放在任務這邊：它知道任務，collections 不需要知道。
   */
  function removeProject(id: string, options: { deleteTasks?: boolean } = {}): void {
    const project = collections.removeProject(id)
    if (!project) return

    const affected = items.value.filter((t) => t.projectId === id).map((t) => ({ ...t }))
    if (options.deleteTasks) {
      items.value = items.value.filter((t) => t.projectId !== id)
    } else {
      for (const task of items.value) {
        if (task.projectId === id) task.projectId = null
      }
    }

    history.record({
      label: options.deleteTasks
        ? `刪除專案「${project.name}」與 ${affected.length} 項任務`
        : `刪除專案「${project.name}」，${affected.length} 項移至未分類`,
      undo: () => {
        collections.restoreProject(project)
        if (options.deleteTasks) {
          items.value = sortByOrder([...items.value, ...affected])
        } else {
          const ids = new Set(affected.map((a) => a.id))
          for (const task of items.value) {
            if (ids.has(task.id)) task.projectId = id
          }
        }
      },
    })
  }

  /** 刪除標籤時一併從所有任務身上移除，避免留下指向不存在標籤的 id。 */
  function removeTag(id: string): void {
    const tag = collections.removeTag(id)
    if (!tag) return

    const affected = new Set(items.value.filter((t) => t.tagIds.includes(id)).map((t) => t.id))
    for (const task of items.value) {
      if (task.tagIds.includes(id)) task.tagIds = task.tagIds.filter((t) => t !== id)
    }

    history.record({
      label: `刪除標籤「${tag.name}」`,
      undo: () => {
        collections.restoreTag(tag)
        for (const task of items.value) {
          if (affected.has(task.id)) task.tagIds = [...task.tagIds, id]
        }
      },
    })
  }

  return {
    items,
    isLoading,
    loadError,
    writeError,
    migration,
    visible,
    counts,
    groupsOf,
    countOf,
    overdue,
    remaining,
    query,
    childrenOf,
    init,
    flush,
    add,
    addSubtask,
    update,
    remove,
    clearCompleted,
    toggle,
    move,
    setPriority,
    reschedule,
    batchUpdate,
    batchRemove,
    batchComplete,
    batchReschedule,
    importBackup,
    mergeRemote,
    setRecurrence,
    toggleTag,
    removeProject,
    removeTag,
  }
})
