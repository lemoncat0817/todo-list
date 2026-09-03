-- 0026：create_task 在共享工作區必須落到「目前選中的工作區」，不是建立者的個人工作區。
--
-- 0004 的 derive_task_workspace() 在 project_id 為 null 時，一律用
-- personal_workspace_id(呼叫者) 當收件匣——那是「只有自己的工作區」年代的
-- 合理預設。M0 之後邀請是把人加進擁有者的個人工作區（見 0025），受邀者
-- 左上角選的是 A 的工作區、新增卻不帶 project_id（本機還沒拉到 A 的收件匣
-- 專案時就會這樣：拉取是 updated_at > 游標，A 很久沒改過的收件匣列會被
-- 游標跳過）。trigger 看到 null，就把任務寫進 B 自己的個人工作區。畫面
-- 上就是「選了 A，新增卻跑到 B」。
--
-- 修法分兩層，缺一不可：
-- 1) create_task 把 payload 的 workspace_id 寫進 INSERT，trigger 才看得到。
--    先前這欄根本沒進 INSERT，client 就算送了也是 NEW.workspace_id = null。
-- 2) trigger 在 project_id 為 null 但 workspace_id 有值、且呼叫者是該工作區
--    成員時，用那個工作區的收件匣，不再無條件落到個人工作區。
-- project_id 有值時行為不變：永遠依專案反推，不採信 client 的 workspace_id。

create or replace function public.derive_task_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_actor uuid := coalesce(new.user_id, (select auth.uid()));
begin
  if new.project_id is not null then
    select workspace_id into v_workspace from public.projects where id = new.project_id;
    if v_workspace is null then
      raise exception 'project % 不存在或尚未歸屬工作區', new.project_id;
    end if;
    new.workspace_id := v_workspace;
  else
    if new.workspace_id is not null then
      if not exists (
        select 1 from public.workspace_members wm
         where wm.workspace_id = new.workspace_id and wm.user_id = v_actor
      ) then
        raise exception '沒有權限在這個工作區新增任務' using errcode = 'TK003';
      end if;
      v_workspace := new.workspace_id;
    else
      v_workspace := public.personal_workspace_id(v_actor);
    end if;
    new.workspace_id := v_workspace;
    select id into new.project_id from public.projects where workspace_id = v_workspace and is_inbox;
  end if;
  return new;
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
  returning * into v_row;

  return v_row;
end;
$$;
