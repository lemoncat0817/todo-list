import type { StoredAttachment, StoredComment, StoredFilter, StoredProject, StoredTag, StoredTask } from '@/db/schema'

/**
 * 本地形狀（camelCase）與遠端資料表（snake_case）之間的轉換。
 *
 * 推送方向（to*）：組出要送給 PostgREST 的 JSON body。刻意不帶 `user_id`——
 * 資料表把它設成 `default auth.uid()`，讓「這筆屬於誰」完全由請求的 JWT
 * 決定，client 端沒有欄位可以拿來造假別人的資料。
 *
 * 拉取方向（from*）：只做欄位改名（snake_case → camelCase），不做驗證。
 * 驗證交給 `domain/task.ts` 既有的 normalize* 函式——遠端資料跟 IndexedDB、
 * 舊版 localStorage、備份檔一樣是跨信任邊界的外部輸入，待遇必須一致。
 */

export const TABLE_TASKS = 'tasks'
export const TABLE_PROJECTS = 'projects'
export const TABLE_TAGS = 'tags'
export const TABLE_FILTERS = 'filters'
export const TABLE_COMMENTS = 'comments'
export const TABLE_ACTIVITY = 'activity_log'
export const TABLE_ATTACHMENTS = 'attachments'

/** 墓碑：REST 輪詢沒有天生的刪除事件，用這個欄位標記「這筆已經不存在了」。 */
export interface Tombstone {
  id: string
  deleted_at: number
}

export function isTombstone(row: { deleted_at?: unknown }): boolean {
  return typeof row.deleted_at === 'number'
}

/**
 * 回傳型別是 Record<string, unknown> 而非 Tombstone——這樣才能跟 toRemote*
 * 的回傳型別一起放進同一個要送出去的陣列，不必額外轉型。
 *
 * 一定要帶 updated_at：pull 走的是 `updated_at > 游標` 這個查詢
 * （sync/restClient.ts 的 fetchRowsSince），墓碑要是沒有一個夠新的
 * updated_at，別的裝置的游標永遠會落在它後面，這筆刪除就永遠拉不到、
 * 那台裝置會一直以為這筆資料還在——實測發現的，不是憑空補的欄位。
 */
export function makeTombstone(id: string): Record<string, unknown> {
  const now = Date.now()
  return { id, deleted_at: now, updated_at: now }
}

// ------------------------------------------------------------------ tasks

export function toRemoteTask(task: StoredTask): Record<string, unknown> {
  return {
    id: task.id,
    task_name: task.taskName,
    is_completed: task.isCompleted,
    rank: task.rank,
    notes: task.notes,
    priority: task.priority,
    due_date: task.dueDate,
    due_time: task.dueTime,
    project_id: task.projectId,
    tag_ids: task.tagIds,
    parent_id: task.parentId,
    recurrence: task.recurrence,
    completed_at: task.completedAt,
    assignee_id: task.assigneeId,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    deleted_at: null,
    // workspace_id 刻意不送：derive_task_workspace() trigger 永遠依
    // project_id 反推、不採信 client 送的值（見 supabase/migrations/0004），
    // client 端永遠是唯讀。
  }
}

/** 只做改名，回傳的形狀交給 normalizeTask 驗證，這裡不假設任何欄位一定存在。 */
export function fromRemoteTask(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    taskName: row.task_name,
    isCompleted: row.is_completed,
    rank: row.rank,
    notes: row.notes,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    projectId: row.project_id,
    tagIds: row.tag_ids,
    parentId: row.parent_id,
    recurrence: row.recurrence,
    completedAt: row.completed_at,
    assigneeId: row.assignee_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id,
  }
}

// ---------------------------------------------------------------- projects

export function toRemoteProject(project: StoredProject): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    rank: project.rank,
    updated_at: project.updatedAt,
    deleted_at: null,
    // 建立時明確帶 workspace_id，是在共享工作區底下新建專案唯一的路徑
    // （create_project 的 derive_workspace_id() trigger：沒帶才落個人
    // 工作區，帶了就尊重，見 supabase/migrations/0004／0010）。之後的
    // patch 不會改到這個值（沒有「搬到別的工作區」這個操作），
    // diffFields 產生補丁時自然不會把它送進 apply_project_patch。
    workspace_id: project.workspaceId,
    // is_inbox 刻意不送：這欄位完全由伺服器決定（handle_new_user() 與
    // 既有帳號的補建遷移），create_project／apply_project_patch 這兩支
    // RPC 也不讀 payload 裡的這個鍵——client 端永遠是唯讀。
  }
}

export function fromRemoteProject(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    rank: row.rank,
    updatedAt: row.updated_at,
    isInbox: row.is_inbox,
    workspaceId: row.workspace_id,
  }
}

// -------------------------------------------------------------------- tags

export function toRemoteTag(tag: StoredTag): Record<string, unknown> {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    updated_at: tag.updatedAt,
    deleted_at: null,
    // 理由同 toRemoteProject 的 workspace_id 註解。
    workspace_id: tag.workspaceId,
  }
}

export function fromRemoteTag(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id,
  }
}

// ----------------------------------------------------------------- filters

export function toRemoteFilter(filter: StoredFilter): Record<string, unknown> {
  return {
    id: filter.id,
    name: filter.name,
    query: filter.query,
    color: filter.color,
    rank: filter.rank,
    updated_at: filter.updatedAt,
    deleted_at: null,
    // 理由同 toRemoteProject 的 workspace_id 註解。
    workspace_id: filter.workspaceId,
  }
}

export function fromRemoteFilter(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    color: row.color,
    rank: row.rank,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id,
  }
}

// ---------------------------------------------------------------- comments

export function toRemoteComment(comment: StoredComment): Record<string, unknown> {
  return {
    id: comment.id,
    task_id: comment.taskId,
    body: comment.body,
    mentioned_user_ids: comment.mentionedUserIds,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    deleted_at: null,
    // author_id 刻意不送：跟 tasks 表的 user_id 同一個理由——資料庫的
    // default auth.uid() 決定作者是誰，client 端沒有欄位可以造假。
  }
}

export function fromRemoteComment(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    body: row.body,
    mentionedUserIds: row.mentioned_user_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------- activity

// 沒有 toRemoteActivity：活動記錄完全由伺服器端的 trigger 產生
// （supabase/migrations/0013_activity_log.sql），client 端只拉不推，
// 也沒有對應的 create/patch RPC 可以送。
export function fromRemoteActivity(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    kind: row.kind,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// -------------------------------------------------------------- attachments

/**
 * 跟其餘表不同：這裡的 toRemoteAttachment 不是給 outbox 用的（附件
 * 完全不走 outbox，見 stores/attachments.ts 開頭的說明），而是給
 * upload() 直接組 POST body 用——留在這裡是為了跟其他表的欄位對應
 * 邏輯放在同一個地方，不是因為它會被同一套 enqueueCollectionOps 呼叫。
 */
export function toRemoteAttachment(attachment: StoredAttachment): Record<string, unknown> {
  return {
    id: attachment.id,
    task_id: attachment.taskId,
    file_name: attachment.fileName,
    file_size: attachment.fileSize,
    content_type: attachment.contentType,
    storage_path: attachment.storagePath,
    created_at: attachment.createdAt,
    updated_at: attachment.updatedAt,
    deleted_at: null,
    // uploader_id 刻意不送：跟 comments 的 author_id 同一個理由——
    // 資料庫的 default auth.uid() 決定上傳者是誰。
  }
}

export function fromRemoteAttachment(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    taskId: row.task_id,
    uploaderId: row.uploader_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    contentType: row.content_type,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
