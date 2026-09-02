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
