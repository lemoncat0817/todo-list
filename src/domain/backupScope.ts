import type { BackupPayload } from '@/db/backup'
import type { StoredFilter, StoredProject, StoredTag, StoredTask } from '@/db/schema'

export interface ScopeBackupOptions {
  currentWorkspaceId: string | null
  targetInboxId?: string | null
  canManageProjects?: boolean
  validMemberIds?: ReadonlySet<string>
  existingProjectIds?: ReadonlySet<string>
  validSectionIds?: ReadonlySet<string>
  now?: number
}

/**
 * 將匯入的備份資料重新對齊至目標工作區環境。
 *
 * 1. currentWorkspaceId 為 null（純本機模式）：不更動任何資料，完整保留單機模式行為。
 * 2. currentWorkspaceId 有值時：
 *    - 覆寫所有 tasks／projects／tags／filters 的 workspaceId 為該工作區。
 *    - 排除備份檔中原本的收件匣專案（isInbox: true），避免在同一個工作區產生第二個收件匣。
 *    - 原本屬於舊收件匣、或無專案（projectId 為 null）的任務，重新對齊至目前工作區的預設收件匣（targetInboxId）。
 *    - 若使用者在該工作區不具備管理專案權限（!canManageProjects），排除新建專案，原指向那些新專案的任務回退至收件匣。
 *    - 清洗無效的負責人（assigneeId）與區段（sectionId），避免在推送時觸發後端 Trigger 例外。
 *    - 推進 updatedAt，確保跨裝置同步與 LWW 合併時版本能正常推進。
 */
export function scopeBackupToWorkspace(
  data: BackupPayload,
  options: ScopeBackupOptions,
): BackupPayload {
  const { currentWorkspaceId } = options
  if (currentWorkspaceId === null) {
    return data
  }

  const now = options.now ?? Date.now()
  const targetInboxId = options.targetInboxId ?? null
  const canManageProjects = options.canManageProjects ?? true
  const validMemberIds = options.validMemberIds ?? new Set<string>()
  const existingProjectIds = options.existingProjectIds ?? new Set<string>()
  const validSectionIds = options.validSectionIds ?? new Set<string>()

  // 1. 識別備份中的收件匣專案
  const importedInbox = data.projects.find((p) => p.isInbox)
  const oldInboxId = importedInbox?.id ?? null

  // 2. 專案處理
  let projects: StoredProject[]
  if (canManageProjects) {
    // 排除備份中舊的收件匣專案，其餘專案皆改寫 workspaceId
    projects = data.projects
      .filter((p) => !p.isInbox)
      .map((p) => ({
        ...p,
        workspaceId: currentWorkspaceId,
        updatedAt: Math.max(p.updatedAt, now),
      }))
  } else {
    // 沒有管理專案權限（例如一般 member）：不能建立新專案，僅能保留並更新工作區內既有已存在的專案
    projects = data.projects
      .filter((p) => !p.isInbox && existingProjectIds.has(p.id))
      .map((p) => ({
        ...p,
        workspaceId: currentWorkspaceId,
        updatedAt: Math.max(p.updatedAt, now),
      }))
  }

  const allowedProjectIds = new Set([
    ...existingProjectIds,
    ...projects.map((p) => p.id),
    ...(targetInboxId ? [targetInboxId] : []),
  ])

  // 3. 標籤與篩選器
  const tags: StoredTag[] = data.tags.map((t) => ({
    ...t,
    workspaceId: currentWorkspaceId,
    updatedAt: Math.max(t.updatedAt, now),
  }))

  const filters: StoredFilter[] = data.filters.map((f) => ({
    ...f,
    workspaceId: currentWorkspaceId,
    updatedAt: Math.max(f.updatedAt, now),
  }))

  // 4. 任務處理
  const tasks: StoredTask[] = data.tasks.map((t) => {
    let projectId: string | null = t.projectId

    // 若原任務無專案、或指向舊收件匣專案
    if (projectId === null || projectId === oldInboxId) {
      projectId = targetInboxId
    } else if (!allowedProjectIds.has(projectId)) {
      // 若原專案不存在且不能被建立，降級回退到收件匣
      projectId = targetInboxId
    }

    // 清洗跨工作區不合法之負責人
    const assigneeId =
      t.assigneeId !== null && validMemberIds.has(t.assigneeId) ? t.assigneeId : null

    // 清洗跨工作區或跨專案不合法之區段
    const sectionId =
      t.sectionId !== null && validSectionIds.has(t.sectionId) ? t.sectionId : null

    return {
      ...t,
      workspaceId: currentWorkspaceId,
      projectId,
      assigneeId,
      sectionId,
      updatedAt: Math.max(t.updatedAt, now),
    }
  })

  return {
    tasks,
    projects,
    tags,
    filters,
  }
}
