import type { Op, OpKind } from '@/db/schema'
import { SUPABASE_URL } from './config'
import { SyncHttpError, headers, safeText } from './restClient'

/**
 * outbox 上傳器打 PostgREST 的 RPC 端點（`/rest/v1/rpc/<function>`），
 * 取代舊版 tableSync.ts 的整列 upsert。每個 op kind 對應固定一支
 * 資料庫函式（見 supabase/migrations/0006_outbox_rpc.sql、
 * 0007_more_rpc.sql）——create 送完整列，patch／delete 都是送補丁
 * （delete 只是碰巧補丁內容一定包含 deleted_at，機制上跟 patch完全一樣，
 * 見 db/schema.ts 的 Op 型別註解）。
 *
 * 回傳值不解析：drain 迴圈只在意成功或失敗，套用之後的資料仍然是
 * 靠既有的 pull-since-cursor 拉回來，不會少一份。
 */
const RPC_BY_KIND: Record<OpKind, { fn: string; params: (op: Op) => Record<string, unknown> }> = {
  'task.create': { fn: 'create_task', params: (op) => ({ p_op_id: op.id, p_row: op.payload }) },
  'task.patch': { fn: 'apply_task_patch', params: (op) => ({ p_op_id: op.id, p_task_id: op.targetId, p_patch: op.payload }) },
  'task.delete': { fn: 'apply_task_patch', params: (op) => ({ p_op_id: op.id, p_task_id: op.targetId, p_patch: op.payload }) },

  'project.create': { fn: 'create_project', params: (op) => ({ p_op_id: op.id, p_row: op.payload }) },
  'project.patch': { fn: 'apply_project_patch', params: (op) => ({ p_op_id: op.id, p_project_id: op.targetId, p_patch: op.payload }) },
  'project.delete': { fn: 'apply_project_patch', params: (op) => ({ p_op_id: op.id, p_project_id: op.targetId, p_patch: op.payload }) },

  'tag.create': { fn: 'create_tag', params: (op) => ({ p_op_id: op.id, p_row: op.payload }) },
  'tag.patch': { fn: 'apply_tag_patch', params: (op) => ({ p_op_id: op.id, p_tag_id: op.targetId, p_patch: op.payload }) },
  'tag.delete': { fn: 'apply_tag_patch', params: (op) => ({ p_op_id: op.id, p_tag_id: op.targetId, p_patch: op.payload }) },

  'filter.create': { fn: 'create_filter', params: (op) => ({ p_op_id: op.id, p_row: op.payload }) },
  'filter.patch': { fn: 'apply_filter_patch', params: (op) => ({ p_op_id: op.id, p_filter_id: op.targetId, p_patch: op.payload }) },
  'filter.delete': { fn: 'apply_filter_patch', params: (op) => ({ p_op_id: op.id, p_filter_id: op.targetId, p_patch: op.payload }) },
}

/** 把一個 op 送到它對應的 RPC。失敗時丟出 SyncHttpError，呼叫端（drain 迴圈）負責重試。 */
export async function sendOp(op: Op, accessToken: string): Promise<void> {
  const { fn, params } = RPC_BY_KIND[op.kind]
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(params(op)),
  })
  if (!res.ok) throw new SyncHttpError(fn, 'rpc', res.status, await safeText(res))
}
