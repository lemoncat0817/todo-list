-- 0028：create_* 對「同一個 id 已經存在」也要冪等，不只對同一個 op_id。
--
-- processed_ops 只擋「同一筆 op 重送」（網路逾時後 client 用同一個 op_id
-- 再打一次）。但 outbox 也可能排出一筆 *新的* create、帶不同的 op_id、
-- 目標卻是伺服器上已經有的那列——常見成因：本機的內容指紋
-- （stores/tasks.ts 的 persistedIndex）在工作階段中被清空（例如 Vite HMR
-- 重跑 setup 函式時，Pinia 的 items 還在、閉包裡的 Map 卻是新的空的），
-- flush() 就把每一列都當成「從來沒見過」再排一次 task.create。
--
-- 那時第一筆 create 早就成功寫進 tasks，第二筆 INSERT 撞 tasks_pkey
-- （23505）→ 整段函式 rollback（連剛插進 processed_ops 的那列一起退）
-- → client 以為失敗、用同一個新 op_id 一直重試 → 永遠 409。op_id 去重
-- 對這種「不同 op、同一個目標 id」幫不上忙。
--
-- 修法：INSERT ... ON CONFLICT (id) DO NOTHING，撞到既有列就回傳現況，
-- *不要* DO UPDATE——create 帶的是建立當下的完整快照，覆蓋會把之後
-- 已經套用過的 patch 蓋掉（0007 註解講過同一件事）。其他 create_* 一併
-- 套上，同一類毒丸（poison pill）不會只出現在 tasks。

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
    project_id, tag_ids, parent_id, recurrence, completed_at, assignee_id, section_id,
    workspace_id, created_at, updated_at
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
    (p_row->>'section_id')::uuid,
    (p_row->>'workspace_id')::uuid,
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.tasks where id = (p_row->>'id')::uuid;
  end if;

  return v_row;
end;
$$;

create or replace function public.create_project(p_op_id uuid, p_row jsonb)
returns public.projects
language plpgsql
as $$
declare
  v_row public.projects;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.projects where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.projects (id, name, color, rank, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#1d4ed8'),
    p_row->>'rank',
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.projects where id = (p_row->>'id')::uuid;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_tag(p_op_id uuid, p_row jsonb)
returns public.tags
language plpgsql
as $$
declare
  v_row public.tags;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tags where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.tags (id, name, color, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#15803d'),
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.tags where id = (p_row->>'id')::uuid;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_filter(p_op_id uuid, p_row jsonb)
returns public.filters
language plpgsql
as $$
declare
  v_row public.filters;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.filters where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.filters (id, name, query, color, rank, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    p_row->>'query',
    coalesce(p_row->>'color', '#7c3aed'),
    p_row->>'rank',
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.filters where id = (p_row->>'id')::uuid;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_comment(p_op_id uuid, p_row jsonb)
returns public.comments
language plpgsql
as $$
declare
  v_row public.comments;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.comments where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.comments (id, task_id, body, mentioned_user_ids, created_at, updated_at)
  values (
    (p_row->>'id')::uuid,
    (p_row->>'task_id')::uuid,
    p_row->>'body',
    case when p_row ? 'mentioned_user_ids'
      then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_row->'mentioned_user_ids') x)
      else '{}' end,
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.comments where id = (p_row->>'id')::uuid;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_section(p_op_id uuid, p_row jsonb)
returns public.sections
language plpgsql
as $$
declare
  v_row public.sections;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.sections where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.sections (id, project_id, name, rank, created_at, updated_at)
  values (
    (p_row->>'id')::uuid,
    (p_row->>'project_id')::uuid,
    p_row->>'name',
    p_row->>'rank',
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.sections where id = (p_row->>'id')::uuid;
  end if;

  return v_row;
end;
$$;
