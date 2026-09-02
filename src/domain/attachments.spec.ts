import { describe, it, expect } from 'vitest'
import { formatFileSize } from './attachments'

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
