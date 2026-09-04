/** 跟 supabase/migrations/0019_maintenance.sql 的 v_quota 同一個值。 */
export const WORKSPACE_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024

/** 用量（含這次要上傳的檔案）達到這個比例時給軟提示，還沒擋上傳。 */
export const WORKSPACE_STORAGE_WARN_RATIO = 0.9

export type QuotaVerdict = 'ok' | 'near' | 'full'

/**
 * 上傳前的配額判斷：滿額硬擋；接近上限（預設 90%）只警告。
 * usedBytes 是工作區目前已用，incomingBytes 是這次檔案大小。
 */
export function classifyQuota(usedBytes: number, incomingBytes: number): QuotaVerdict {
  const next = usedBytes + incomingBytes
  if (next > WORKSPACE_STORAGE_QUOTA_BYTES) return 'full'
  const warnAt = WORKSPACE_STORAGE_QUOTA_BYTES * WORKSPACE_STORAGE_WARN_RATIO
  if (usedBytes >= warnAt || next >= warnAt) return 'near'
  return 'ok'
}

/**
 * 附件檔案大小的人類可讀格式。用 1024 為底（KiB／MiB 的算法），
 * 沿用作業系統檔案總管、瀏覽器下載清單的慣例，不是 1000（那是網路
 * 頻寬慣用的算法）——使用者對「檔案大小」的直覺是前者。
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  // 剛好是整數時（2.0 KB）不留小數點；只有真的有小數要顯示時才留一位。
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${units[unitIndex]}`
}
