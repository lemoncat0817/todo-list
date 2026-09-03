import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { loadAttachments, saveAttachments } from '@/db'
import type { StoredAttachment } from '@/db/schema'
import { TABLE_ATTACHMENTS, toRemoteAttachment } from '@/sync/rowMapping'
import { callRpc, SyncHttpError, upsertRows } from '@/sync/restClient'
import {
  attachmentStoragePath,
  deleteAttachmentFile,
  downloadAttachmentFile,
  uploadAttachmentFile,
} from '@/sync/storageClient'
import { useAuthStore } from './auth'
import { useWorkspaceStore } from './workspace'

/**
 * 跟 supabase/migrations/0019_maintenance.sql 的 v_quota 常數同一個值
 * ——這裡只是「上傳前先問一次，省得白白傳完整個檔案才被拒絕」的提前
 * 檢查，真正擋得住的是資料庫那邊的 trigger（enforce_attachment_quota），
 * 兩邊數字要保持一致，但這裡改壞了也不會讓配額失效，只是提示會慢一拍。
 */
const WORKSPACE_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024

/**
 * 附件（M3）。跟 comments.ts／activity.ts 最大的不同：upload()／remove()
 * 完全不走 outbox。上傳需要把真正的檔案位元組送到 Storage，離線時
 * 沒辦法「先在本地記一筆，之後再補送」——outbox 那套是為了小巧的 JSON
 * 補丁設計的，硬塞進去等於要把整個檔案 base64 編碼存進 IndexedDB 的
 * outbox store，一個附件就可能是好幾 MB，不是這個機制該負擔的量級。
 * upload()／remove() 因此是直接、同步等待的網路操作，需要在線上才能用，
 * 失敗就是失敗、不會自動重試——跟 stores/sync.ts 的背景輪詢重試是
 * 兩種不同的可靠性模型，UI 端（TaskAttachments.vue）要能分得出來。
 */
export const useAttachmentsStore = defineStore('attachments', () => {
  const items = ref<StoredAttachment[]>([])
  const auth = useAuthStore()
  const workspace = useWorkspaceStore()

  const uploading = ref(false)
  const error = ref<string | null>(null)

  const byTask = computed(() => {
    const map = new Map<string, StoredAttachment[]>()
    for (const entry of [...items.value].sort((a, b) => a.createdAt - b.createdAt)) {
      const bucket = map.get(entry.taskId)
      if (bucket) bucket.push(entry)
      else map.set(entry.taskId, [entry])
    }
    return map
  })

  function forTask(taskId: string): StoredAttachment[] {
    return byTask.value.get(taskId) ?? []
  }

  async function load(): Promise<void> {
    items.value = await loadAttachments()
  }

  /** 純量欄位而已（不像 comments 的 mentionedUserIds／activity 的 detail），toRaw 就夠，不需要再逐一展開巢狀欄位。 */
  async function persist(): Promise<void> {
    await saveAttachments(items.value.map((a) => toRaw(a)))
  }

  function mergeRemote(rows: readonly StoredAttachment[]): void {
    const byId = new Map(items.value.map((a) => [a.id, a]))
    for (const row of rows) byId.set(row.id, row)
    items.value = [...byId.values()]
  }

  /**
   * 一次性的網路操作失敗說法，刻意不跟 stores/sync.ts 的 describeSyncError
   * 共用文字——那邊的「稍後會自動重試」對背景輪詢是真話，對這裡的
   * upload()／remove()（使用者按一次、失敗就是失敗，沒有背景重試機制）
   * 會是假話，不能照搬。
   */
  function describeAttachmentError(e: unknown): string {
    if (e instanceof TypeError) return '目前連不上網路，請檢查連線後重試'
    // 前端已經先問過一次用量（見 upload() 的預先檢查），這裡是防線
    // ——搶在同一瞬間、或跳過前端直接呼叫 API 的情況才會真的走到資料庫
    // 那道 trigger。錯誤內容裡的中文訊息就是給使用者看的，直接拿來用，
    // 不必再翻譯一次成通用的「伺服器暫時無法處理」。
    if (e instanceof SyncHttpError && e.message.includes('容量已滿')) {
      return '這個工作區的附件容量已滿（上限 500MB），請先刪除不需要的附件'
    }
    // 單檔超過 storage.buckets.file_size_limit（見
    // supabase/migrations/0014_attachments.sql，目前 10MB）時，
    // Supabase Storage 自己（不是 PostgREST）用 413 回應——不是
    // SyncHttpError.code 讀得到的 PostgREST JSON 形狀（{code,...}），
    // 這裡改認 HTTP 狀態碼本身，不必依賴回應內文格式。
    if (e instanceof SyncHttpError && e.status === 413) {
      return '這個檔案超過單檔大小上限（10MB），請壓縮或分割後再上傳'
    }
    if (e instanceof SyncHttpError) return '伺服器暫時無法處理，請稍後再試一次'
    return '發生未預期的問題，請再試一次'
  }

  /**
   * 上傳前先問一次目前用量——省得使用者等完整個檔案傳完才被拒絕。
   * 沒有目前工作區（純本機模式，或還沒切到任何工作區）時跳過檢查，
   * 讓真正的錯誤處理（若有）留給伺服器那道 trigger。查詢本身失敗
   * （例如網路不穩）也不擋上傳——這只是提前檢查，不是唯一防線。
   */
  async function checkQuota(file: File, token: string): Promise<boolean> {
    const workspaceId = workspace.currentWorkspaceId
    if (!workspaceId) return true
    try {
      const used = await callRpc<number>('workspace_storage_used', { p_workspace: workspaceId }, token)
      return used + file.size <= WORKSPACE_STORAGE_QUOTA_BYTES
    } catch (e) {
      console.error('[attachments] 查詢工作區用量失敗，略過預先檢查', e)
      return true
    }
  }

  async function upload(taskId: string, file: File): Promise<void> {
    if (!workspace.canWriteTasks) return
    const token = auth.session?.access_token
    if (!token) return
    uploading.value = true
    error.value = null
    try {
      if (!(await checkQuota(file, token))) {
        error.value = '這個工作區的附件容量已滿（上限 500MB），請先刪除不需要的附件'
        return
      }

      const id = crypto.randomUUID()
      const path = attachmentStoragePath(taskId, id, file.name)
      await uploadAttachmentFile(path, file, token)

      const now = Date.now()
      const attachment: StoredAttachment = {
        id,
        taskId,
        // 只有已登入才會走到這裡（見上方檔案開頭說明的使用前提）；
        // 空字串是 defensive fallback，不是預期會走到的分支。
        uploaderId: auth.session?.user.id ?? '',
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream',
        storagePath: path,
        createdAt: now,
        updatedAt: now,
      }
      // 直接 upsert 一筆，不是走 create_task 那種 op_id 去重 RPC——
      // 附件的建立本來就是使用者按一次「上傳」觸發的單次動作，沒有
      // outbox 重送的疑慮，用 restClient.ts 既有的 upsertRows 就夠。
      await upsertRows(TABLE_ATTACHMENTS, [toRemoteAttachment(attachment)], token)

      items.value.push(attachment)
      await persist()
    } catch (e) {
      console.error('[attachments] 上傳失敗', e)
      error.value = describeAttachmentError(e)
      throw e
    } finally {
      uploading.value = false
    }
  }

  async function remove(attachment: StoredAttachment): Promise<void> {
    if (!workspace.canWriteTasks) return
    const token = auth.session?.access_token
    if (!token) return
    error.value = null
    try {
      await deleteAttachmentFile(attachment.storagePath, token)
      const now = Date.now()
      await upsertRows(TABLE_ATTACHMENTS, [{ id: attachment.id, deleted_at: now, updated_at: now }], token)

      items.value = items.value.filter((a) => a.id !== attachment.id)
      await persist()
    } catch (e) {
      console.error('[attachments] 刪除失敗', e)
      error.value = describeAttachmentError(e)
      throw e
    }
  }

  async function download(attachment: StoredAttachment): Promise<void> {
    const token = auth.session?.access_token
    if (!token) return
    error.value = null
    try {
      await downloadAttachmentFile(attachment.storagePath, attachment.fileName, token)
    } catch (e) {
      console.error('[attachments] 下載失敗', e)
      error.value = describeAttachmentError(e)
      throw e
    }
  }

  return { items, uploading, error, forTask, load, persist, mergeRemote, upload, remove, download }
})
