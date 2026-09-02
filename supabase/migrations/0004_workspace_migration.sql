-- M0：把既有資料（單使用者、以 user_id 分隔）搬進工作區模型。
-- 這個檔案不動 RLS——舊的 user_id-based policy 在這裡結束時仍然完整
-- 有效，所以就算這個遷移單獨部署，既有前端也不會有任何一刻被擋下。
--
-- 欄位新增時故意不給 workspace_id 預設值：讓它維持 nullable，靠下面的
-- derive_* trigger 在 insert 當下補上。這樣舊版前端（送出的 payload
-- 完全不含 workspace_id 這個鍵）跟這次遷移本身的資料回填走同一條
-- 「沒有就推導」邏輯，不需要為了相容舊前端另外分支。

-- profiles 的 auth.users insert trigger（0003）只顧得到之後才註冊的人，
-- 既有帳號要在這裡手動回填一次。
insert into public.profiles (id, display_name, updated_at)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
       (extract(epoch from clock_timestamp()) * 1000)::bigint
  from auth.users u
 on conflict (id) do nothing;

-- 每位既有使用者各得一個不可刪除、不可退出的個人工作區。
insert into public.workspaces (name, is_personal, created_by, updated_at)
select '個人工作區', true, u.id, (extract(epoch from clock_timestamp()) * 1000)::bigint
  from auth.users u
 where not exists (
   select 1 from public.workspaces w where w.created_by = u.id and w.is_personal
 );

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.created_by, 'owner'
  from public.workspaces w
 where w.is_personal
   and not exists (
     select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = w.created_by
   );

alter table public.projects add column workspace_id uuid references public.workspaces(id);
alter table public.projects add column is_inbox boolean not null default false;
alter table public.tags add column workspace_id uuid references public.workspaces(id);
alter table public.filters add column workspace_id uuid references public.workspaces(id);
alter table public.tasks add column workspace_id uuid references public.workspaces(id);

-- project_role() 要 join projects.workspace_id，欄位現在才存在，所以
-- 這個函式（跟依賴它的 can_write_task/can_comment，以及 project_members
-- 的 policy）挪到這裡才定義——0003 建表時這欄位還不存在。
create or replace function public.project_role(p_project uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select pm.role from public.project_members pm
      where pm.project_id = p_project and pm.user_id = (select auth.uid())),
    (select wm.role from public.projects p
       join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = p_project and wm.user_id = (select auth.uid()))
  );
$$;

create or replace function public.can_write_task(p_project uuid)
returns boolean
language sql
stable
as $$
  select public.project_role(p_project) in ('owner', 'admin', 'member');
$$;

create or replace function public.can_comment(p_project uuid)
returns boolean
language sql
stable
as $$
  select public.project_role(p_project) in ('owner', 'admin', 'member', 'commenter');
$$;

create policy project_members_select on public.project_members
  for select using (public.project_role(project_id) is not null);

create policy project_members_write on public.project_members
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and public.can_manage_project(p.workspace_id))
  )
  with check (
    exists (select 1 from public.projects p where p.id = project_id and public.can_manage_project(p.workspace_id))
  );

-- 每個工作區最多一個收件匣，derive_task_workspace() 靠這個唯一性才能
-- 用 limit 1 放心地取值，不用擔心選到哪一個是未定義行為。
create unique index projects_one_inbox_per_workspace on public.projects (workspace_id) where is_inbox;

create or replace function public.reject_inbox_delete()
returns trigger language plpgsql as $$
begin
  if old.is_inbox then
    raise exception '收件匣專案不能被刪除';
  end if;
  return old;
end;
$$;
create trigger projects_protect_inbox before delete on public.projects
  for each row execute function public.reject_inbox_delete();

-- 0003 的 handle_new_user() 只建 profile；新使用者（M0 上線之後才
-- 註冊的帳號）沒有走過上面「既有帳號回填」那幾段 insert，得在同一個
-- trigger 裡把個人工作區、owner 成員資格、收件匣專案一次建好，
-- 不然這個人第一次建立任務時 workspace_id 推導不到值，整筆會被拒絕。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  insert into public.profiles (id, display_name, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          (extract(epoch from clock_timestamp()) * 1000)::bigint);

  insert into public.workspaces (name, is_personal, created_by, updated_at)
  values ('個人工作區', true, new.id, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  returning id into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner');

  insert into public.projects (id, user_id, name, color, rank, workspace_id, is_inbox, updated_at)
  values (gen_random_uuid(), new.id, '收件匣', '#6b7280', 'A', v_workspace, true,
          (extract(epoch from clock_timestamp()) * 1000)::bigint);

  return new;
end;
$$;

-- projects/tags/filters：只有「client 完全沒送這個欄位」時才補值，
-- 送了就尊重送的值——這三張表本來就是使用者自己的容器，日後
-- （M2 之後）在共享工作區底下新建專案就是靠明確帶 workspace_id 做到。
create or replace function public.derive_workspace_id()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is null then
    new.workspace_id := public.personal_workspace_id(coalesce(new.user_id, (select auth.uid())));
  end if;
  return new;
end;
$$;
create trigger projects_derive_workspace before insert on public.projects
  for each row execute function public.derive_workspace_id();
create trigger tags_derive_workspace before insert on public.tags
  for each row execute function public.derive_workspace_id();
create trigger filters_derive_workspace before insert on public.filters
  for each row execute function public.derive_workspace_id();

-- tasks：workspace_id 永遠由 project_id 反推，不採信 client 送的值——
-- 這兩者本該是同一件事，讓 project 當唯一真相來源可以避免兩者兜不攏。
-- project_id 是 null（舊版「未分類」）時導去該工作區的收件匣專案，
-- 這一步等於把「隱含的收件匣」換成「真正的收件匣」，跟這次遷移
-- 本身對既有任務做的事完全一致。
-- security definer：內部查 projects 必須看到真實列，不能被呼叫者自己的
-- RLS 過濾——不然「檢視者看得到專案但不能寫任務」會被這個函式的查詢
-- 誤判成「專案不存在」，而不是後面 can_write_task() 該負責的權限拒絕。
create or replace function public.derive_task_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  if new.project_id is not null then
    select workspace_id into v_workspace from public.projects where id = new.project_id;
    if v_workspace is null then
      raise exception 'project % 不存在或尚未歸屬工作區', new.project_id;
    end if;
    new.workspace_id := v_workspace;
  else
    v_workspace := public.personal_workspace_id(coalesce(new.user_id, (select auth.uid())));
    new.workspace_id := v_workspace;
    select id into new.project_id from public.projects where workspace_id = v_workspace and is_inbox;
  end if;
  return new;
end;
$$;
create trigger tasks_derive_workspace before insert on public.tasks
  for each row execute function public.derive_task_workspace();

-- 回填既有資料。
update public.projects set workspace_id = public.personal_workspace_id(user_id) where workspace_id is null;
update public.tags set workspace_id = public.personal_workspace_id(user_id) where workspace_id is null;
update public.filters set workspace_id = public.personal_workspace_id(user_id) where workspace_id is null;

insert into public.projects (id, user_id, name, color, rank, workspace_id, is_inbox, updated_at)
select gen_random_uuid(), w.created_by, '收件匣', '#6b7280', 'A', w.id, true,
       (extract(epoch from clock_timestamp()) * 1000)::bigint
  from public.workspaces w
 where not exists (select 1 from public.projects p where p.workspace_id = w.id and p.is_inbox);

update public.tasks t
   set project_id = (select p.id from public.projects p where p.workspace_id = public.personal_workspace_id(t.user_id) and p.is_inbox)
 where t.project_id is null;

update public.tasks t
   set workspace_id = p.workspace_id
  from public.projects p
 where t.project_id = p.id
   and t.workspace_id is distinct from p.workspace_id;

alter table public.projects alter column workspace_id set not null;
alter table public.tags alter column workspace_id set not null;
alter table public.filters alter column workspace_id set not null;
alter table public.tasks alter column workspace_id set not null;

create index projects_workspace_idx on public.projects (workspace_id);
create index tags_workspace_idx on public.tags (workspace_id);
create index filters_workspace_idx on public.filters (workspace_id);
create index tasks_workspace_idx on public.tasks (workspace_id);

-- tasks.project_id 刻意維持 nullable：正式把它設成 not null 會讓還沒
-- 更新到新版的舊前端寫入被拒（見計畫書第 11 節）。derive_task_workspace
-- 已經讓「不帶 project_id」的舊寫入自動落進收件匣，資料本身不會再有
-- 缺口；not null 這道約束延後到確認舊前端／Service Worker 快取都已經
-- 換版後，另外用 supabase/migrations/deferred/ 底下的腳本手動套用。
