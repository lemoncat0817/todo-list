/**
 * 依「目前所在工作區」判斷一筆資料看不看得到。
 *
 * 跟 views.ts 的 isUncategorized 是同一類東西——純粹的判斷式，被
 * stores/tasks.ts 與 stores/collections.ts 共用，所以獨立成檔案而不是
 * 各自重複一份。
 */
export interface HasWorkspace {
  workspaceId: string | null
}

/**
 * currentWorkspaceId 是 null 時（純本機模式、尚未登入、或工作區清單
 * 還沒載入完成）不篩選——這是同步功能加入之前就有的行為，這個判斷式
 * 不能讓純本機使用者反而少看到東西。
 *
 * currentWorkspaceId 有值時，屬於這個工作區的、或者 workspaceId 本身
 * 是 null 的都算看得到。後者刻意放行：剛在本地建立、還沒經過一次完整
 * 推送／拉取的資料，伺服器真正的 workspace_id 要等那一輪跑完才會回填
 * （見 sync/rowMapping.ts 的說明）——不放行的話，使用者剛新增的任務會在
 * 送出的瞬間從畫面上消失，直到下一次同步才重新出現。
 */
export function inCurrentWorkspace(row: HasWorkspace, currentWorkspaceId: string | null): boolean {
  return (
    currentWorkspaceId === null || row.workspaceId === currentWorkspaceId || row.workspaceId === null
  )
}
