-- M5：區段（Section）——專案內的分組，也是看板檢視的欄來源。
--
-- 沒有 workspace_id 欄位：區段永遠透過 project_id 反推所屬工作區，
-- 跟 comments/attachments/activity_log 用 task_id 反推是同一個理由，
-- 不需要自己快取一份給前端篩選可見範圍用——區段本來就只會在「已經
-- 知道是哪個專案」的情境下被讀取（看板頁面、任務詳情的區段選單），
-- 不像 tasks 需要跨專案的收件匣/全部檢視。
--
-- id 沿用其餘表的慣例，由 client 端的 crypto.randomUUID() 產生，
-- 不用 default gen_random_uuid()——離線建立時本地與遠端 id 天生一致。
create table public.sections (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  -- 跟 tasks/projects/filters 同一套字串排序鍵（domain/rank.ts），看板
  -- 欄本身的順序，不是欄內任務的順序——後者沿用 tasks.rank，兩者是
  -- 兩個獨立的排序軸。
  rank text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index sections_project_idx on public.sections (project_id);
-- 拉取（pull）走 updated_at > 游標，理由同其餘表。
create index sections_project_updated_idx on public.sections (project_id, updated_at);

alter table public.sections enable row level security;

-- 权限沿用 can_write_task()（member 以上）而不是 can_manage_project()
-- （admin 以上）：新增/改名/刪除一個看板欄比較接近「整理任務」而不是
-- 「管理專案本身」，跟新增標籤、改任務欄位是同一個授權層級。
create policy sections_select on public.sections
  for select using (public.project_role(project_id) is not null);
create policy sections_insert on public.sections
  for insert with check (public.can_write_task(project_id));
create policy sections_update on public.sections
  for update using (public.can_write_task(project_id)) with check (public.can_write_task(project_id));
create policy sections_delete on public.sections
  for delete using (public.can_write_task(project_id));

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
  returning * into v_row;

  return v_row;
end;
$$;

-- name／rank 可補丁；project_id 不行——沒有「把區段搬去別的專案」這個
-- 操作，跟 filters/tags 的 workspace_id 不可補丁是同一個理由。
create or replace function public.apply_section_patch(p_op_id uuid, p_section_id uuid, p_patch jsonb)
returns public.sections
language plpgsql
as $$
declare
  v_row public.sections;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.sections where id = p_section_id;
    return v_row;
  end if;

  update public.sections s set
    name       = coalesce(p_patch->>'name', s.name),
    rank       = coalesce(p_patch->>'rank', s.rank),
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint,
    deleted_at = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else s.deleted_at end
  where s.id = p_section_id
  returning * into v_row;

  if not found then
    raise exception '區段 % 不存在或沒有寫入權限', p_section_id;
  end if;
  return v_row;
end;
$$;

-- ------------------------------------------------------------- tasks.section_id

alter table public.tasks add column section_id uuid references public.sections(id) on delete set null;
create index tasks_section_idx on public.tasks (section_id);

-- 區段必須屬於任務所在的那個專案——不然「這張卡片在一個屬於別的專案
-- 的欄裡」毫無意義，看板畫面也無從渲染它。跟 validate_task_assignee()
-- 同一個模式：project_id 或 section_id 任一個變動時都要重新檢查，
-- 因為「把任務搬到別的專案」會讓原本合法的 section_id 失效。
create or replace function public.validate_task_section()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section_project uuid;
begin
  if new.section_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.section_id is not distinct from old.section_id
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  select project_id into v_section_project from public.sections where id = new.section_id;
  if v_section_project is null or v_section_project is distinct from new.project_id then
    raise exception '區段不屬於這個任務所在的專案';
  end if;
  return new;
end;
$$;

create trigger tasks_validate_section before insert or update on public.tasks
  for each row execute function public.validate_task_section();

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
    section_id   = case when p_patch ? 'section_id' then (p_patch->>'section_id')::uuid else t.section_id end,
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
    project_id, tag_ids, parent_id, recurrence, completed_at, assignee_id, section_id, created_at, updated_at
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
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;

  return v_row;
end;
$$;
