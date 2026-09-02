import { SUPABASE_URL } from './config'
import { SyncHttpError, headers, safeText } from './restClient'

/**
 * 附件的檔案本體走 Supabase Storage 的 HTTP API，不裝
 * `@supabase/storage-js`——這裡只用得到三個固定操作（上傳、下載、
 * 刪除），跟 restClient.ts／rpc.ts 同一個理由：手寫 fetch 換一個
 * 通用建構器的重量，划不來。
 *
 * bucket 是 private（見 supabase/migrations/0014_attachments.sql），
 * 所以下載不能給一個能直接分享的網址——瀏覽器的 <a href> 點擊沒辦法附帶
 * 自訂的 Authorization header。下載一律是「用目前登入的 token 抓位元組，
 * 存成本機 Blob URL，再觸發瀏覽器另存」，不是連到一個公開網址。
 */

const BUCKET = 'attachments'

/**
 * 路徑慣例跟 migration 裡 storage.objects 的 RLS policy 假設一致：
 * task_id 一定是第一段（storage.foldername(name) 取出來的那一段），
 * RLS 靠這個反推「這個檔案屬於哪筆任務」。attachment id 混進檔名前綴
 * 是為了避免同一筆任務裡兩個人剛好上傳同名檔案互相覆蓋。
 */
export function attachmentStoragePath(taskId: string, attachmentId: string, fileName: string): string {
  return `${taskId}/${attachmentId}-${fileName}`
}

function objectUrl(path: string): string {
  // path 本身可能含中文檔名，逐段編碼、保留斜線分隔任務資料夾。
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`
}

export async function uploadAttachmentFile(path: string, file: File, accessToken: string): Promise<void> {
  const res = await fetch(objectUrl(path), {
    method: 'POST',
    headers: headers(accessToken, { 'Content-Type': file.type || 'application/octet-stream' }),
    body: file,
  })
  if (!res.ok) throw new SyncHttpError(BUCKET, 'upsert', res.status, await safeText(res))
}

export async function deleteAttachmentFile(path: string, accessToken: string): Promise<void> {
  const res = await fetch(objectUrl(path), { method: 'DELETE', headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(BUCKET, 'delete', res.status, await safeText(res))
}

/**
 * 抓檔案位元組，觸發瀏覽器的另存對話框。不能只給一個 <a href> 網址——
 * 見檔案開頭的說明。呼叫端負責處理拋出的例外（多半是權限被 RLS 擋下，
 * 或檔案已經被刪除）。
 */
export async function downloadAttachmentFile(path: string, fileName: string, accessToken: string): Promise<void> {
  const res = await fetch(objectUrl(path), { method: 'GET', headers: headers(accessToken) })
  if (!res.ok) throw new SyncHttpError(BUCKET, 'fetch', res.status, await safeText(res))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // 跟 DataDialog.vue 的匯出同一個做法：click() 當下就同步觸發瀏覽器
  // 讀取內容，緊接著呼叫 revokeObjectURL 不會讓下載內容變空；不釋放的話
  // 這份 blob 會留在記憶體裡直到分頁關閉。
  URL.revokeObjectURL(url)
}
