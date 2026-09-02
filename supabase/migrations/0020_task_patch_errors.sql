-- M6 補做：計畫書第 13 節——既有的錯誤翻譯層（stores/sync.ts 的
-- describeSyncError()）要延伸到新的失敗類型，這裡先做跟「任務」直接
-- 相關的兩種：權限不足、任務已被他人刪除。
--
-- apply_task_patch() 原本不管三種完全不同的原因——task_id 根本不存在、
-- 呼叫者不是這個任務所在專案/工作區的成員（被 RLS 擋下）、任務已經被
-- 別人刪除——UPDATE 一律是 0 rows，一律丟出同一句「任務 % 不存在或
-- 沒有寫入權限」。前端因此永遠沒辦法分辨該顯示「你被移出了這個工作區」
-- 還是「這筆任務被刪除了，重新整理看最新狀態」，只能顯示最保守、
-- 有時候會誤導的通用訊息。

-- ------------------------------------------------- 分類 apply_task_patch 的失敗原因

-- security definer 只是為了「分類」——回傳一個粗粒度的三選一字串
-- （not_found／deleted／forbidden），不回傳任務的實際內容（名稱、
-- 備註…），呼叫者也只有在 apply_task_patch() 底下的 UPDATE 已經確定
-- 0 rows 之後才會用到它，不是開放給前端隨意查詢任意 task_id 是否存在
-- 的公開介面。這裡刻意不 revoke authenticated 的 EXECUTE 權限——
-- apply_task_patch() 本身不是 security definer（那樣會讓底下真正的
-- UPDATE 也跟著繞過 RLS，等於任何人都能改任何工作區的任務，是完全
-- 不能接受的），呼叫這支分類函式時是以呼叫者自己的身分（authenticated）
-- 執行，若把 EXECUTE 收回，apply_task_patch() 內部呼叫它也會一併被擋。
-- 這裡揭露的資訊量（一個不可猜測的 UUID 是否存在／已刪除／沒權限）
-- 跟 workspace_storage_used()（既有、同樣是 security definer 但直接
-- 開放給前端呼叫）同一個風險等級，不是新引入的洩漏面。
create or replace function public.classify_task_patch_failure(p_task_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_deleted_at bigint;
begin
  select deleted_at into v_deleted_at from public.tasks where id = p_task_id;

  if not found then
    return 'not_found';
  end if;
  if v_deleted_at is not null then
    return 'deleted';
  end if;
  return 'forbidden';
end;
$$;

revoke execute on function public.classify_task_patch_failure(uuid) from anon;

-- ------------------------------------------------- apply_task_patch 的兩處變更

-- 1) WHERE 子句多加 `t.deleted_at is null or p_patch ? 'deleted_at'`：
--    已經被刪除的任務不能再被「一般欄位編輯」的補丁默默改動（那會讓
--    一個以為自己在編輯正常任務的使用者，實際上是在復活一具墓碑的
--    某些欄位，其他成員完全不會被告知）。補丁本身如果就是在動
--    deleted_at（刪除、或還原），仍然放行——包括「刪除同一筆任務
--    兩次」這種既有的冪等行為（task.delete 也是走這支 RPC，見
--    sync/rpc.ts 的 RPC_BY_KIND）。
-- 2) UPDATE 仍然 0 rows 時，用上面的分類函式決定要丟哪一種例外，
--    各自帶一個自訂 SQLSTATE（PT001/PT002/PT003）給前端的
--    SyncHttpError.code 讀，不再是同一句話、同一個預設的 P0001。
create or replace function public.apply_task_patch(p_op_id uuid, p_task_id uuid, p_patch jsonb)
returns public.tasks
language plpgsql
as $$
declare
  v_row public.tasks;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_reason text;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tasks where id = p_task_id;
    return v_row;
  end if;

  update public.tasks t set
    task_name    = coalesce(p_patch->>'task_name', t.task_name),
    is_completed = coalesce((p_patch->>'is_completed')::boolean, t.is_completed),
    rank         = coalesce(p_patch->>'rank', t.rank),
    notes        = coalesce(p_patch->>'notes', t.notes),
    priority     = coalesce((p_patch->>'priority')::smallint, t.priority),
    due_date     = case when p_patch ? 'due_date' then p_patch->>'due_date' else t.due_date end,
    due_time     = case when p_patch ? 'due_time' then p_patch->>'due_time' else t.due_time end,
    project_id   = coalesce((p_patch->>'project_id')::uuid, t.project_id),
    tag_ids      = case when p_patch ? 'tag_ids'
                        then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_patch->'tag_ids') x)
                        else t.tag_ids end,
    parent_id    = case when p_patch ? 'parent_id' then (p_patch->>'parent_id')::uuid else t.parent_id end,
    recurrence   = case when p_patch ? 'recurrence' then p_patch->'recurrence' else t.recurrence end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::bigint else t.completed_at end,
    assignee_id  = case when p_patch ? 'assignee_id' then (p_patch->>'assignee_id')::uuid else t.assignee_id end,
    section_id   = case when p_patch ? 'section_id' then (p_patch->>'section_id')::uuid else t.section_id end,
    deleted_at   = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else t.deleted_at end,
    updated_at   = v_now
  where t.id = p_task_id
    and (t.deleted_at is null or p_patch ? 'deleted_at')
  returning * into v_row;

  if not found then
    v_reason := public.classify_task_patch_failure(p_task_id);
    if v_reason = 'deleted' then
      raise exception '任務已經被其他成員刪除' using errcode = 'PT001';
    elsif v_reason = 'forbidden' then
      raise exception '沒有權限編輯這筆任務' using errcode = 'PT003';
    else
      raise exception '任務 % 不存在或沒有寫入權限', p_task_id using errcode = 'PT002';
    end if;
  end if;
  return v_row;
end;
$$;
