-- M0：多人協作的容器層。工作區是計費／邀請的邊界，四張既有表
-- （tasks/projects/tags/filters）之後都掛在某個工作區底下，而不是
-- 直接掛在 user_id 底下——這是「共享」得以存在的前提。
--
-- 這個檔案只建表與工具函式，不動既有表的資料、不換 RLS。既有的
-- user_id-based policy 在這個檔案跑完之後仍然完整有效，行為零改變；
-- 資料搬遷放在 0004，RLS 替換放在最後的 0005——這樣 RLS 換手時
-- 成員表已經有資料，不會出現「換了規則但還沒有人被列為成員」的空窗。

create type public.member_role as enum ('owner', 'admin', 'member', 'commenter', 'viewer');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 個人工作區在遷移時逐一建立，不可被刪除或讓最後一個成員離開。
  is_personal boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- auth.users 不開放跨使用者讀取，指派人／留言者的顯示名稱需要另一張
-- 可以被其他成員讀到的表。由 auth.users 的 insert trigger 自動建立一列，
-- 不需要前端在註冊流程另外呼叫一次 API。
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

-- 專案成員：這張表在 M0 只建立，實際會有列是 M2 邀請流程之後的事。
-- project_role() 查不到專案層級的覆蓋時，落回工作區層級的角色。
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          (extract(epoch from clock_timestamp()) * 1000)::bigint);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- project_role() 要 join projects.workspace_id，這個欄位要到 0004 才新增
-- （這張表現在還是舊的 user_id-based schema）——所以 project_role() 跟
-- 依賴它的 can_write_task()/can_comment()，以及 project_members 的 RLS
-- policy，都挪到 0004 加完欄位之後再定義，這裡先只放不依賴該欄位的部分。

create or replace function public.workspace_role(p_workspace uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select wm.role from public.workspace_members wm
   where wm.workspace_id = p_workspace and wm.user_id = (select auth.uid());
$$;

create or replace function public.can_manage_project(p_workspace uuid)
returns boolean
language sql
stable
as $$
  select public.workspace_role(p_workspace) in ('owner', 'admin');
$$;

create or replace function public.personal_workspace_id(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id from public.workspaces w
   where w.created_by = p_user and w.is_personal
   limit 1;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.profiles enable row level security;
alter table public.project_members enable row level security;

create policy workspaces_select on public.workspaces
  for select using (public.workspace_role(id) is not null);

create policy workspace_members_select on public.workspace_members
  for select using (public.workspace_role(workspace_id) is not null);

create policy workspace_members_write on public.workspace_members
  for all using (public.workspace_role(workspace_id) in ('owner', 'admin'))
          with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

-- 顯示名稱只給同一個工作區的人看，不是公開的使用者目錄。
create policy profiles_select on public.profiles
  for select using (
    id = (select auth.uid())
    or exists (
      select 1 from public.workspace_members me
        join public.workspace_members them on them.workspace_id = me.workspace_id
       where me.user_id = (select auth.uid()) and them.user_id = profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update using (id = (select auth.uid()))
            with check (id = (select auth.uid()));

-- project_members 的 policy（select 要用到 project_role()）留給 0004
-- 在欄位／函式都齊全之後再建立；RLS 已經開啟，這段空窗期間預設全部
-- 拒絕，不是「暫時開放」。
