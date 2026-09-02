import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 把一個 user id 換成畫面上的顯示名稱，靠 workspace.members 解析——
 * TaskComments.vue（留言作者）跟 TaskActivity.vue（事件的觸發者）
 * 都要用到同一套邏輯，抽出來避免兩處各自維護一份判斷式。
 *
 * 不另外打 API：workspace.members 本來就會在登入、以及切換工作區時
 * 載入目前工作區的成員列表，這裡要問的人（留言作者、任務事件的
 * 觸發者）只可能是「這個任務所屬工作區的成員」。
 */
export function useMemberName() {
  const auth = useAuthStore()
  const workspace = useWorkspaceStore()

  return function memberName(userId: string | null): string {
    if (userId === null) return '系統'
    if (userId === auth.session?.user.id) return '我'
    const member = workspace.members.find((m) => m.user_id === userId)
    // 找不到代表對方已經離開這個工作區——紀錄仍然留著，只是顯示不出目前的名字。
    if (!member) return '已離開的成員'
    return member.profiles?.display_name || '（未命名）'
  }
}
