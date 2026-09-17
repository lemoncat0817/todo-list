import { describe, it, expect, beforeEach } from 'vitest'
import { freshPinia } from '@/test/helpers'
import { useUiStore } from './ui'

describe('ui store', () => {
  beforeEach(() => {
    freshPinia()
  })

  it('初始狀態正確', () => {
    const ui = useUiStore()
    expect(ui.isSearch).toBe(false)
    expect(ui.keyword).toBe('')
    expect(ui.isSidebarOpen).toBe(false)
    expect(ui.detailTaskId).toBeNull()
    expect(ui.isPaletteOpen).toBe(false)
    expect(ui.isDetailCollapsed).toBe(false)
    expect(ui.selectedIds).toEqual([])
  })

  describe('搜尋狀態 (search)', () => {
    it('toggleSearch 可切換搜尋開關，關閉搜尋時會清空關鍵字', () => {
      const ui = useUiStore()

      // 開啟搜尋
      ui.toggleSearch()
      expect(ui.isSearch).toBe(true)

      // 輸入關鍵字
      ui.keyword = '買牛奶'
      expect(ui.keyword).toBe('買牛奶')

      // 關閉搜尋
      ui.toggleSearch()
      expect(ui.isSearch).toBe(false)
      expect(ui.keyword).toBe('')
    })
  })

  describe('側邊欄與抽屜 (sidebar)', () => {
    it('openSidebar / closeSidebar 可正常切換開關', () => {
      const ui = useUiStore()

      ui.openSidebar()
      expect(ui.isSidebarOpen).toBe(true)

      ui.closeSidebar()
      expect(ui.isSidebarOpen).toBe(false)
    })
  })

  describe('命令面板 (palette)', () => {
    it('openPalette / closePalette 可正常切換面板狀態', () => {
      const ui = useUiStore()

      ui.openPalette()
      expect(ui.isPaletteOpen).toBe(true)

      ui.closePalette()
      expect(ui.isPaletteOpen).toBe(false)
    })
  })

  describe('任務詳情面板 (detail)', () => {
    it('openDetail / closeDetail 可正確設定與清空選中任務 ID', () => {
      const ui = useUiStore()

      ui.openDetail('task-123')
      expect(ui.detailTaskId).toBe('task-123')

      ui.closeDetail()
      expect(ui.detailTaskId).toBeNull()
    })

    it('toggleDetailCollapsed 可切換詳情欄手動收合狀態', () => {
      const ui = useUiStore()

      expect(ui.isDetailCollapsed).toBe(false)
      ui.toggleDetailCollapsed()
      expect(ui.isDetailCollapsed).toBe(true)
      ui.toggleDetailCollapsed()
      expect(ui.isDetailCollapsed).toBe(false)
    })
  })

  describe('批次多選狀態 (selection)', () => {
    it('toggleSelected 可切換單一任務選取狀態', () => {
      const ui = useUiStore()

      ui.toggleSelected('t-1')
      expect(ui.isSelected('t-1')).toBe(true)
      expect(ui.selectedIds).toEqual(['t-1'])

      ui.toggleSelected('t-2')
      expect(ui.isSelected('t-2')).toBe(true)
      expect(ui.selectedIds).toEqual(['t-1', 't-2'])

      ui.toggleSelected('t-1')
      expect(ui.isSelected('t-1')).toBe(false)
      expect(ui.selectedIds).toEqual(['t-2'])
    })

    it('setSelection 可直接設定多筆選取 ID', () => {
      const ui = useUiStore()

      ui.setSelection(['a', 'b', 'c'])
      expect(ui.selectedIds).toEqual(['a', 'b', 'c'])
      expect(ui.isSelected('b')).toBe(true)
      expect(ui.isSelected('d')).toBe(false)
    })

    it('clearSelection 可清空所有選取', () => {
      const ui = useUiStore()

      ui.setSelection(['a', 'b', 'c'])
      expect(ui.selectedIds.length).toBe(3)

      ui.clearSelection()
      expect(ui.selectedIds).toEqual([])
      expect(ui.isSelected('a')).toBe(false)
    })
  })
})
