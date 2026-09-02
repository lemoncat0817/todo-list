export const DB_NAME = 'todolist'
/**
 * v1: tasks + meta。
 * v2: 擴充任務欄位，新增 projects 與 tags。
 * v3: 新增 filters（儲存的篩選器查詢）。
 * v4: 新增 outbox（離線操作佇列，見下方 Op）——這是真的新 store，
 *     不是像 updatedAt 那樣補個欄位就好，所以要動版號。
 * v5: tasks／projects／filters 的排序鍵從浮點數 order 換成字串 rank
 *     （domain/rank.ts）。這次要動版號，理由跟前幾次「補欄位不用動」
 *     不一樣：order 索引換成 rank 索引，是 index 結構本身變了，而且
 *     既有列的 order 數值要換算成 rank 字串，不是留著讓正規化補預設值
 *     就能矇混過去——沒有 upgrade() 搬資料的話，既有使用者的排序會
 *     整個垮掉。
 * v6: 新增 comments（任務留言，M3）——又是真的新 store，不是補欄位。
 * v7: 新增 activity（活動記錄，M3）——同上，全新 store。
 *
 * projects／tags／filters 後來補上的 updatedAt（跨裝置同步要用它判斷哪一邊
 * 較新，見 sync/merge.ts）不需要新的版號：IndexedDB 的 object store 本來就
 * 沒有固定 schema，新增欄位不需要 upgrade() 搬資料，既有列在讀取時
 * 由 normalizeProject/normalizeTag/normalizeFilter 補上 updatedAt（缺值時
 * 視為現在）即可，跟其他任何邊界正規化走同一條路。只有新增／變動 store
 * 或 index 結構、或既有資料需要真的換算才需要動版號。
 */
export const DB_VERSION = 7

export const STORE_TASKS = 'tasks'
export const STORE_META = 'meta'
export const STORE_PROJECTS = 'projects'
export const STORE_TAGS = 'tags'
export const STORE_FILTERS = 'filters'
export const STORE_OUTBOX = 'outbox'
export const STORE_COMMENTS = 'comments'
export const STORE_ACTIVITY = 'activity'

/** meta 用來記錄一次性遷移是否已完成，避免重複執行。 */
export const META_MIGRATED_FROM_LOCALSTORAGE = 'migratedFromLocalStorage'

/**
 * 同步游標。放在 IndexedDB 的 meta 而不是 localStorage：這些數字要跟本地
 * 資料的生命週期綁在一起——清掉 IndexedDB 時游標也該歸零，下次同步才會
 * 從頭拉一次而不是誤以為早就同步過。
 *
 * FINGERPRINT_* 存的是「上次成功推送到遠端時，每一列的內容序列化字串」，
 * 讓離線時刪除的任務也能在重新連線後正確產生墓碑——這份指紋必須跨重新整理
 * 存活，跟 stores/tasks.ts 裡只在單一工作階段內有效的 persistedIndex
 * 是兩個不同的東西：那份記的是「IndexedDB 裡有什麼」，這份記的是
 * 「伺服器上有什麼」。
 */
export const META_SYNC_LAST_PULLED_AT = 'syncLastPulledAt'
// tasks 不在這裡：outbox 取代了它的指紋比對推送，見 stores/sync.ts
// 的 drainOutbox()／pullTasks()。'syncFingerprintTasks' 這個 key 可能還
// 留在既有使用者的 IndexedDB 裡，不影響——沒有程式碼再讀它。
export const META_SYNC_FINGERPRINT_PROJECTS = 'syncFingerprintProjects'
export const META_SYNC_FINGERPRINT_TAGS = 'syncFingerprintTags'
export const META_SYNC_FINGERPRINT_FILTERS = 'syncFingerprintFilters'

/**
 * 記錄「這台裝置目前的本地快取（tasks／projects／tags／filters 加上上面
 * 幾把游標／指紋）最後一次是跟哪個 Supabase user id 對過帳」。
 *
 * 這不是一般意義下的使用者資料，是同步引擎自己的簿記——刻意放在跟游標／
 * 指紋同一個 meta store，理由相同：要跟本地資料的生命週期綁在一起，
 * 清掉 IndexedDB 時它也該跟著歸零，不能活得比本地資料還久。
 *
 * 存在的唯一理由是讓 stores/sync.ts 的 start() 能分辨「這次登入的人，
 * 跟上次留下這份本地快取的人是不是同一個」——不是同一個人時，本地快取
 * 就不該被當成「這個人的資料」拿去合併或推送（見 stores/sync.ts
 * reconcileAccountIdentity 的完整說明）。刻意不在 signOut() 時清掉：
 * 登出後這份本地快取邏輯上仍然「屬於」剛登出的那個人（離線優先，
 * signOut 本來就不動本地資料），下一次不管是同一個人重新登入、還是換了
 * 別人登入，都要靠這把 key 還在，才分得出兩者的差異。
 */
export const META_SYNC_ACCOUNT_ID = 'syncAccountId'

/**
 * 離線操作佇列。取代舊版「比對本地內容指紋算差異」的推送方式——那套
 * 在多人情境下會把別人剛下推的變更誤判成本地變更再推回去（見計畫書
 * 第 6 節）。改成使用者一做動作就在本地記一筆操作，上傳器照 createdAt
 * 依序送出、成功即刪，離線時只是持續累積、不會卡住。
 *
 * id 是操作本身的 id（重送時不變，伺服器用它去重），不是被操作的那一列
 * 的 id——那個放在 targetId。
 */
export type OpKind =
  | 'task.create'
  | 'task.patch'
  | 'task.delete'
  | 'project.create'
  | 'project.patch'
  | 'project.delete'
  | 'tag.create'
  | 'tag.patch'
  | 'tag.delete'
  | 'filter.create'
  | 'filter.patch'
  | 'filter.delete'
  | 'comment.create'
  | 'comment.patch'
  | 'comment.delete'

export interface Op {
  id: string
  kind: OpKind
  targetId: string
  /** create 是完整列；patch 只放有變動的欄位；delete 通常是空物件。 */
  payload: Record<string, unknown>
  createdAt: number
  /** 失敗重試次數，上傳器用來算退避間隔。 */
  attempts: number
}

/** 未分類：刪除專案時任務的去處，不是一筆真的 project 紀錄。 */
export const UNCATEGORIZED = null

export type Priority = 0 | 1 | 2 | 3

/**
 * 選單與快捷鍵一律走這個順序：最重要的排最前面。
 * 內部值維持 0–3（3 最高）以免資料遷移，但對外一律用主流待辦工具常見的 P1–P4
 * ——P1 是最高，這是許多使用者已經帶著的直覺，改內部值不值得。
 */
export const PRIORITY_ORDER: readonly Priority[] = [3, 2, 1, 0]

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'P4',
  1: 'P3',
  2: 'P2',
  3: 'P1',
}

/** 選單用：光看 P1 分不出高低，補上中文說明。 */
export const PRIORITY_DESCRIPTIONS: Record<Priority, string> = {
  0: 'P4（無）',
  1: 'P3（低）',
  2: 'P2（中）',
  3: 'P1（高）',
}

/** RFC 5545 的星期代碼，方便日後匯出 .ics 時直接對應。 */
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
}

/**
 * 重複規則。
 *
 * 欄位命名刻意對齊 RFC 5545（iCalendar）：freq / interval / byDay /
 * byMonthDay / until / count。日後若要支援 .ics 匯入匯出，
 * 換成 rrule 是「映射」而不是「資料遷移」。
 * 目前不引入 rrule —— 實測它要 +13.18 kB gzip，而這裡只需要常見的幾種規則。
 */
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly'
  /** 每 N 天 / 週 / 月，至少為 1。 */
  interval: number
  /** freq='weekly' 時指定星期幾；空陣列代表沿用起始日的星期。 */
  byDay: Weekday[]
  /** freq='monthly' 時指定每月幾號；null 代表沿用起始日。 */
  byMonthDay: number | null
  /** 結束日（含），格式 YYYY-MM-DD。 */
  until: string | null
  /** 總共重複幾次；與 until 擇一使用。 */
  count: number | null
}

export interface StoredTask {
  id: string
  taskName: string
  isCompleted: boolean
  /**
   * 可插值的字串排序鍵（domain/rank.ts）。v5 之前是浮點數（domain/ordering.ts，
   * 現已移除）——多人協作下，兩台裝置同時拖曳到同一個間隙時，浮點數中點
   * 會算出完全相同的值，字串鍵沒有精度上限，碰撞用 withJitter() 而不是
   * 整份重新編號解決。
   */
  rank: string

  // --- v2 新增 ---
  notes: string
  priority: Priority
  /** YYYY-MM-DD，null 代表未設定到期日。 */
  dueDate: string | null
  /** HH:mm，需搭配 dueDate 才有意義。 */
  dueTime: string | null
  projectId: string | null
  tagIds: string[]
  /** 子任務的父項 id；null 代表頂層任務。 */
  parentId: string | null
  recurrence: Recurrence | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
  /**
   * 這筆任務所屬的工作區——由伺服器的 derive_task_workspace() trigger
   * 依 project_id 反推決定，client 端唯讀（toRemoteTask 不送出這個欄位，
   * 送了也會被忽略）。本地只在拉取回來時記錄，用途是日後依工作區篩選
   * 可見任務；null 代表這筆還沒跟伺服器同步過、或本來就在未設定同步的
   * 純本機模式下建立。
   */
  workspaceId: string | null
}

export interface StoredProject {
  id: string
  name: string
  color: string
  rank: string
  /** v4 新增，供跨裝置同步判斷衝突時哪一邊較新（見 sync/merge.ts）。 */
  updatedAt: number
  /**
   * 這個專案所屬的工作區。跟 StoredTask.workspaceId 不同：這裡不是唯讀——
   * 建立新專案時 client 會明確指定（見 stores/collections.ts 的
   * addProject()），因為 create_project RPC 是「client 沒送這個欄位才落
   * 個人工作區，送了就尊重送的值」（supabase/migrations/0004 的
   * derive_workspace_id() trigger），這是在共享工作區底下新建專案唯一
   * 的路徑。null 代表尚未同步過、或純本機模式。
   */
  workspaceId: string | null
  /**
   * 這個工作區的收件匣專案——伺服器端建立（handle_new_user()／既有帳號的
   * 補建遷移），client 端唯讀，永遠不會自己建立或改動這個欄位。
   *
   * 存在的理由：`create_task` RPC 對「沒帶 project_id」的任務，回傳的
   * project_id 是這個工作區真正的收件匣 UUID，不是 null（實測驗證，見
   * supabase/migrations/0004 的 derive_task_workspace()）。task 從遠端
   * 拉回來、合併進本地之後，若直接採信這個真實 UUID，「收件匣」檢視
   * （domain/views.ts 認的是 task.projectId === null）跟拖著它走的側邊欄
   * 專案清單就會同時壞掉：任務從收件匣消失，同時冒出一個看起來像使用者
   * 自建、卻刪不掉的「收件匣」專案。用這個欄位讓兩層各自認得「這其實是
   * 收件匣」，而不是讓收件匣的意義本身分裂成兩種。
   */
  isInbox: boolean
}

export interface StoredTag {
  id: string
  name: string
  color: string
  updatedAt: number
  /** 所屬工作區，語意與 StoredProject.workspaceId 相同——建立時可明確指定。 */
  workspaceId: string | null
}

/**
 * 儲存的篩選器。
 *
 * query 存的是原始查詢字串而不是解析後的 AST：AST 的形狀會隨語言演進而改變，
 * 存字串則永遠可以用新的解析器重新讀一次，不需要資料遷移。
 */
export interface StoredFilter {
  id: string
  name: string
  query: string
  color: string
  rank: string
  updatedAt: number
  /** 所屬工作區，語意與 StoredProject.workspaceId 相同——建立時可明確指定。 */
  workspaceId: string | null
}

/**
 * 任務底下的留言（M3）。
 *
 * 沒有 workspaceId 欄位：留言的可見性／寫入權限完全依附於它所屬的任務
 * （伺服器端透過 join tasks 判斷，見 supabase/migrations/0011_comments.sql），
 * 不像 tasks/projects/tags/filters 需要自己快取一份 workspaceId 讓同步
 * 輪詢／依工作區篩選畫面用得到。
 */
export interface StoredComment {
  id: string
  taskId: string
  /** 留言作者的 user id——本地端唯讀，永遠由伺服器的 auth.uid() 決定。 */
  authorId: string
  body: string
  /**
   * 留言裡 @提及的成員 user id——建立／編輯留言時由 client 端解析
   * body 裡的 `@顯示名稱` 比對目前工作區成員名單算出來，資料庫端
   * 不重新解析文字（見 supabase/migrations/0012_comment_mentions.sql）。
   * 只負責存「提到了誰」這個結構化事實，被提及不會觸發任何通知——
   * 那是 M4（推播通知）的範圍。
   */
  mentionedUserIds: string[]
  createdAt: number
  updatedAt: number
}

/**
 * 活動記錄的種類——只涵蓋資料庫 trigger 真的會記的幾種「事件」
 * （見 supabase/migrations/0013_activity_log.sql 的說明）。
 */
export type ActivityKind = 'created' | 'completed' | 'reopened' | 'moved'

/**
 * 任務活動記錄（M3）。純粹是拉取進來的唯讀資料——完全由伺服器端的
 * trigger 產生，本地端沒有 add/update/remove，也不會有對應的 outbox
 * op（sync/rpc.ts 沒有、也不需要 activity.create 這種 op kind）。
 */
export interface StoredActivity {
  id: string
  taskId: string
  /** 觸發這筆事件的人；null 代表不是透過一般使用者請求寫入的（測試、遷移、伺服器端批次作業）。 */
  actorId: string | null
  kind: ActivityKind
  detail: Record<string, unknown>
  createdAt: number
  /** 恆等於 createdAt——活動記錄不可變，這個欄位只是為了跟其餘表共用同一套依 updatedAt 判斷新舊的拉取機制。 */
  updatedAt: number
}

/** v1 的任務形狀，遷移時用來辨識舊資料。 */
export interface LegacyTaskV1 {
  id: string
  taskName: string
  isCompleted: boolean
  order: number
}

export const DEFAULT_TASK_FIELDS: Omit<
  StoredTask,
  'id' | 'taskName' | 'isCompleted' | 'rank' | 'createdAt' | 'updatedAt'
> = {
  notes: '',
  priority: 0,
  dueDate: null,
  dueTime: null,
  projectId: UNCATEGORIZED,
  tagIds: [],
  parentId: null,
  recurrence: null,
  completedAt: null,
  workspaceId: null,
}

/**
 * 專案與標籤的可選顏色。
 *
 * 用固定調色盤而非自由選色器有兩個理由：自由選色讓使用者能選出在深色模式下
 * 讀不到的顏色，而這裡的顏色只出現在小圓點上，色相太接近反而分不出來。
 * 十二色已經超過大多數人實際會建立的專案數。
 */
export interface CollectionColor {
  name: string
  value: string
}

export const COLLECTION_COLORS: readonly CollectionColor[] = [
  { name: '靛藍', value: '#1d4ed8' },
  { name: '天藍', value: '#0284c7' },
  { name: '青綠', value: '#0d9488' },
  { name: '森綠', value: '#15803d' },
  { name: '萊姆', value: '#65a30d' },
  { name: '琥珀', value: '#d97706' },
  { name: '橘', value: '#ea580c' },
  { name: '紅', value: '#dc2626' },
  { name: '玫瑰', value: '#e11d48' },
  { name: '紫', value: '#7c3aed' },
  { name: '洋紅', value: '#c026d3' },
  { name: '石墨', value: '#64748b' },
]

export const DEFAULT_PROJECT_COLOR = '#1d4ed8'
export const DEFAULT_TAG_COLOR = '#15803d'
export const DEFAULT_FILTER_COLOR = '#7c3aed'
