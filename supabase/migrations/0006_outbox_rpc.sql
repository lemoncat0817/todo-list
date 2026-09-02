-- M1：欄位補丁 RPC，取代整列 upsert。整列覆蓋在多人情境下的問題是
-- 「這次推送的所有欄位都當作最新」——兩人各改一個欄位時，後到的一方
-- 會把對方剛存進去的欄位蓋掉。改成 client 只送有變動的欄位，資料庫用
-- jsonb_populate_record 把補丁疊在現有列上，衝突縮小到「同一個欄位」
-- 才會發生。
--
-- op_id 去重：outbox 重送同一筆操作（例如網路逾時後重試，但其實
-- 伺服器已經處理過）不能重複套用。processed_ops 記錄看過的 op_id，
-- 這裡不設自動清除——見計畫書第 4 節，跟墓碑一起排進未來的定期清理。

create table public.processed_ops (
  op_id uuid primary key,
  actor_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- 這張表沒有開 RLS 的話，PostgREST 會直接把它整張暴露出去——任何
-- 登入使用者都能讀到別人的 op_id，甚至塞一筆假的 op_id 讓別人真正的
-- 操作被誤判成「已經處理過」而靜默失效。RPC 函式是 security invoker
-- （下面每個函式都是），所以下面這條 insert policy 也要放行，
-- 不然函式自己內部的去重 insert 也會被同一道 RLS 擋下來。
alter table public.processed_ops enable row level security;
create policy processed_ops_select on public.processed_ops
  for select using (actor_id = (select auth.uid()));
create policy processed_ops_insert on public.processed_ops
  for insert with check (actor_id = (select auth.uid()));

-- security invoker（預設）：函式本身不繞過 RLS，實際的寫入權限
-- 仍然由呼叫者身分 + can_write_task() 決定，函式只負責「只覆蓋
-- 補丁裡出現的欄位」這件事，不是另一層授權機制。
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
    "order"      = coalesce((p_patch->>'order')::double precision, t."order"),
    notes        = coalesce(p_patch->>'notes', t.notes),
    priority     = coalesce((p_patch->>'priority')::smallint, t.priority),
    due_date     = case when p_patch ? 'due_date' then p_patch->>'due_date' else t.due_date end,
    due_time     = case when p_patch ? 'due_time' then p_patch->>'due_time' else t.due_time end,
    -- 用 coalesce 不是 ? 判斷存在：M0 之後「未分類」已經是真的收件匣
    -- 專案，patch 不會再有「把 project_id 清成 null」這種合法情境，
    -- 移動任務一律是換成另一個真實 project_id。
    project_id   = coalesce((p_patch->>'project_id')::uuid, t.project_id),
    -- array_agg 掃過空陣列（清空全部標籤）會是 null，不是空陣列，
    -- 用 coalesce 兜回 '{}'——tag_ids 是 not null 欄位，null 會直接違反
    -- 約束，把「清空」誤變成一個會炸掉的 update。
    tag_ids      = case when p_patch ? 'tag_ids'
                        then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_patch->'tag_ids') x)
                        else t.tag_ids end,
    parent_id    = case when p_patch ? 'parent_id' then (p_patch->>'parent_id')::uuid else t.parent_id end,
    recurrence   = case when p_patch ? 'recurrence' then p_patch->'recurrence' else t.recurrence end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::bigint else t.completed_at end,
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
    id, task_name, is_completed, "order", notes, priority, due_date, due_time,
    project_id, tag_ids, parent_id, recurrence, completed_at, created_at, updated_at
  ) values (
    (p_row->>'id')::uuid,
    p_row->>'task_name',
    coalesce((p_row->>'is_completed')::boolean, false),
    (p_row->>'order')::double precision,
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
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- projects/filters 沒有 tasks 那麼多欄位，補丁函式比照精簡版本；
-- tags 沒有 order／可補丁的欄位（name/color 直接整欄蓋過即可），
-- 不需要專用的補丁函式，繼續走原本 upsert 即可。
create or replace function public.apply_project_patch(p_op_id uuid, p_project_id uuid, p_patch jsonb)
returns public.projects
language plpgsql
as $$
declare
  v_row public.projects;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.projects where id = p_project_id;
    return v_row;
  end if;

  update public.projects p set
    name       = coalesce(p_patch->>'name', p.name),
    color      = coalesce(p_patch->>'color', p.color),
    "order"    = coalesce((p_patch->>'order')::double precision, p."order"),
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where p.id = p_project_id
  returning * into v_row;

  if not found then
    raise exception '專案 % 不存在或沒有寫入權限', p_project_id;
  end if;
  return v_row;
end;
$$;

create or replace function public.apply_filter_patch(p_op_id uuid, p_filter_id uuid, p_patch jsonb)
returns public.filters
language plpgsql
as $$
declare
  v_row public.filters;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.filters where id = p_filter_id;
    return v_row;
  end if;

  update public.filters f set
    name       = coalesce(p_patch->>'name', f.name),
    query      = coalesce(p_patch->>'query', f.query),
    color      = coalesce(p_patch->>'color', f.color),
    "order"    = coalesce((p_patch->>'order')::double precision, f."order"),
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where f.id = p_filter_id
  returning * into v_row;

  if not found then
    raise exception '篩選器 % 不存在或沒有寫入權限', p_filter_id;
  end if;
  return v_row;
end;
$$;

create index processed_ops_created_idx on public.processed_ops (created_at);
