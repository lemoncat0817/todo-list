-- M3 補做：任務指派給單一負責人（計畫書 02 節功能對標表原本就把「指派
-- 負責人」列為 M3 項目，前幾輪只做了留言／提及／活動記錄／附件／線上
-- 狀態，這塊漏掉了——這裡補齊）。
--
-- 單一負責人而不是多人指派：跟大多數同類產品一致（見計畫書），也讓
-- M5「依負責人分組」的檢視邏輯是單純的 group by，不必處理一筆任務
-- 同時屬於多個群組。

alter table public.tasks add column assignee_id uuid references auth.users(id) on delete set null;

-- 供 M5「依負責人分組」使用，也是這張表少數會被拿來做等值查詢/分組的
-- 欄位（其餘都是整批拉回本地再由前端處理）。
create index tasks_assignee_idx on public.tasks (assignee_id);

-- 指派對象必須是任務所屬工作區的成員——不然「指派給一個看不到這個
-- 工作區的人」這個狀態毫無意義，對方也永遠不會知道自己被指派了。
-- 不透過 workspace_id 欄位判斷（那個欄位在 UPDATE 時不會重算，見
-- 0004 的 derive_task_workspace() 只掛在 before insert），而是直接從
-- project_id 現查，這樣不管新增還是搬動專案都一定是對的。
create or replace function public.validate_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  if new.assignee_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  select p.workspace_id into v_workspace from public.projects p where p.id = new.project_id;
  if v_workspace is null or not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = v_workspace and wm.user_id = new.assignee_id
  ) then
    raise exception '指派對象不是這個工作區的成員';
  end if;
  return new;
end;
$$;

create trigger tasks_validate_assignee before insert or update on public.tasks
  for each row execute function public.validate_task_assignee();

-- apply_task_patch／create_task 兩支 RPC 補上這個欄位，補丁模式跟
-- due_date／parent_id 一樣用 `?` 判斷鍵是否存在（null 是合法的「取消
-- 指派」，跟「patch 根本沒帶這個欄位」要分得開，不能用 coalesce）。
create or replace function public.apply_task_patch(p_op_id uuid, p_task_id uuid, p_patch jsonb)
returns public.tasks
language plpgsql
as $$
declare
  v_row public.tasks;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
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
    deleted_at   = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else t.deleted_at end,
    updated_at   = v_now
  where t.id = p_task_id
  returning * into v_row;

  if not found then
    raise exception '任務 % 不存在或沒有寫入權限', p_task_id;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_task(p_op_id uuid, p_row jsonb)
returns public.tasks
language plpgsql
as $$
declare
  v_row public.tasks;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tasks where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.tasks (
    id, task_name, is_completed, rank, notes, priority, due_date, due_time,
    project_id, tag_ids, parent_id, recurrence, completed_at, assignee_id, created_at, updated_at
  ) values (
    (p_row->>'id')::uuid,
    p_row->>'task_name',
    coalesce((p_row->>'is_completed')::boolean, false),
    p_row->>'rank',
    coalesce(p_row->>'notes', ''),
    coalesce((p_row->>'priority')::smallint, 0),
    p_row->>'due_date',
    p_row->>'due_time',
    (p_row->>'project_id')::uuid,
    case when p_row ? 'tag_ids'
      then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_row->'tag_ids') x)
      else '{}' end,
    (p_row->>'parent_id')::uuid,
    p_row->'recurrence',
    (p_row->>'completed_at')::bigint,
    (p_row->>'assignee_id')::uuid,
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;

  return v_row;
end;
$$;
