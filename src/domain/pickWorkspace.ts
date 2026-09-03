/**
 * 決定「目前該看哪個工作區」。
 *
 * 被邀進別人的個人工作區時，對方的列也是 is_personal=true——若只找
 * 第一個 is_personal，reload 後可能又落到別人的工作區。優先順序：
 * 1. 使用者上次選過、且現在還在清單裡的
 * 2. 自己建立的個人工作區（is_personal 且 created_by 是自己）
 * 3. 任意 is_personal（理論上不該走到，當作後備）
 * 4. 清單第一筆
 */
export interface PickableWorkspace {
  id: string
  is_personal: boolean
  created_by: string
}

export function pickCurrentWorkspaceId(
  workspaces: readonly PickableWorkspace[],
  options: { userId: string | null; rememberedId: string | null },
): string | null {
  const { userId, rememberedId } = options
  if (rememberedId !== null && workspaces.some((w) => w.id === rememberedId)) {
    return rememberedId
  }
  if (userId !== null) {
    const mine = workspaces.find((w) => w.is_personal && w.created_by === userId)
    if (mine) return mine.id
  }
  return workspaces.find((w) => w.is_personal)?.id ?? workspaces[0]?.id ?? null
}
