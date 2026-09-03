import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Pinia } from 'pinia'
import TaskAttachments from '@/components/TaskAttachments.vue'
import { useAttachmentsStore } from '@/stores/attachments'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { freshPinia, mountWith, stubDialogs } from '@/test/helpers'

describe('TaskAttachments.vue', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = freshPinia()
    useAuthStore().session = { user: { id: 'me' } } as never
    useWorkspaceStore().members = [
      { user_id: 'me', role: 'owner', joined_at: '2030-01-01', profiles: { display_name: '我自己', avatar_url: null } },
    ]
  })

  afterEach(() => vi.restoreAllMocks())

  const mountAttachments = () => mountWith(TaskAttachments, pinia, { props: { taskId: 'task-1' } })

  it('沒有附件時顯示空狀態', () => {
    const w = mountAttachments()
    expect(w.text()).toContain('還沒有附件')
  })

  it('顯示檔名、大小、上傳者', () => {
    useAttachmentsStore().mergeRemote([
      { id: 'a1', taskId: 'task-1', uploaderId: 'me', fileName: '報告.pdf', fileSize: 2048, contentType: 'application/pdf', storagePath: 'task-1/a1-報告.pdf', createdAt: 1, updatedAt: 1 },
    ])
    const w = mountAttachments()
    expect(w.text()).toContain('報告.pdf')
    expect(w.text()).toContain('2 KB')
    expect(w.text()).toContain('我')
  })

  it('只顯示這筆任務自己的附件', () => {
    useAttachmentsStore().mergeRemote([
      { id: 'a1', taskId: 'task-1', uploaderId: 'me', fileName: 'a.txt', fileSize: 1, contentType: 'text/plain', storagePath: 'task-1/a1-a.txt', createdAt: 1, updatedAt: 1 },
      { id: 'a2', taskId: 'task-2', uploaderId: 'me', fileName: 'b.txt', fileSize: 1, contentType: 'text/plain', storagePath: 'task-2/a2-b.txt', createdAt: 2, updatedAt: 2 },
    ])
    const w = mountAttachments()
    expect(w.findAll('li')).toHaveLength(1)
  })

  it('選擇檔案會呼叫 attachments.upload()', async () => {
    const store = useAttachmentsStore()
    const uploadSpy = vi.spyOn(store, 'upload').mockResolvedValue()
    const w = mountAttachments()

    const file = new File(['hello'], 'x.txt', { type: 'text/plain' })
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    expect(uploadSpy).toHaveBeenCalledWith('task-1', file)
  })

  it('點刪除前會先跳出確認對話框，取消時不呼叫 remove()', async () => {
    const store = useAttachmentsStore()
    store.mergeRemote([
      { id: 'a1', taskId: 'task-1', uploaderId: 'me', fileName: 'x.txt', fileSize: 1, contentType: 'text/plain', storagePath: 'task-1/a1-x.txt', createdAt: 1, updatedAt: 1 },
    ])
    const removeSpy = vi.spyOn(store, 'remove').mockResolvedValue()
    stubDialogs({ confirmReturns: false })
    const w = mountAttachments()

    const deleteButton = w.findAll('button').find((b) => b.text() === '刪除')
    await deleteButton?.trigger('click')

    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('確認後呼叫 attachments.remove()', async () => {
    const store = useAttachmentsStore()
    const attachment = {
      id: 'a1', taskId: 'task-1', uploaderId: 'me', fileName: 'x.txt', fileSize: 1,
      contentType: 'text/plain', storagePath: 'task-1/a1-x.txt', createdAt: 1, updatedAt: 1,
    }
    store.mergeRemote([attachment])
    const removeSpy = vi.spyOn(store, 'remove').mockResolvedValue()
    stubDialogs({ confirmReturns: true })
    const w = mountAttachments()

    const deleteButton = w.findAll('button').find((b) => b.text() === '刪除')
    await deleteButton?.trigger('click')

    expect(removeSpy).toHaveBeenCalledWith(attachment)
  })

  it('顯示 attachments.error', () => {
    const store = useAttachmentsStore()
    store.error = '伺服器暫時無法處理，請稍後再試一次'
    const w = mountAttachments()
    expect(w.text()).toContain('伺服器暫時無法處理，請稍後再試一次')
  })

  /*
   * sr-only 是 position:absolute。少了這個 relative，隱藏的檔案輸入框會以初始
   * 包含區塊定位，不受 App shell 的 overflow-hidden 裁切，把整份文件撐高到它在
   * 詳情面板裡的捲動位置——實測會多出一條頁面捲軸、整個版面被捲上去，下方露出
   * 一片畫布底色。這條斷言看起來像在測樣式，實際上守的是那個版面不變量。
   */
  it('隱藏的檔案輸入框有已定位的祖先，才不會跳出 shell 的裁切範圍', () => {
    const w = mountAttachments()
    const fileLabel = w.find('input[type="file"]').element.parentElement
    expect(fileLabel?.classList.contains('relative')).toBe(true)
  })
})
