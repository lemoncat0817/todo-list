import { describe, it, expect } from 'vitest'
import { formatFileSize, classifyQuota, WORKSPACE_STORAGE_QUOTA_BYTES } from './attachments'

describe('formatFileSize', () => {
  it('小於 1 KB 時顯示位元組', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('KB／MB／GB 依大小自動換算', () => {
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })

  it('小於 10 的值保留一位小數，大於等於 10 不留小數——避免像 12.3 MB 這種假精確度', () => {
    expect(formatFileSize(9.5 * 1024)).toBe('9.5 KB')
    expect(formatFileSize(12.3 * 1024)).toBe('12 KB')
  })
})

describe('classifyQuota', () => {
  const quota = WORKSPACE_STORAGE_QUOTA_BYTES

  it('用量加上這個檔案仍遠低於上限時是 ok', () => {
    expect(classifyQuota(0, 1024)).toBe('ok')
    expect(classifyQuota(quota * 0.5, 1024)).toBe('ok')
  })

  it('達到或超過 90% 時是 near，還沒擋', () => {
    expect(classifyQuota(quota * 0.9, 0)).toBe('near')
    expect(classifyQuota(quota * 0.89, quota * 0.02)).toBe('near')
  })

  it('加上這個檔案會超過 500MB 時是 full', () => {
    expect(classifyQuota(quota - 10, 100)).toBe('full')
    expect(classifyQuota(quota, 1)).toBe('full')
  })
})
