-- 跨裝置同步的資料表。
--
-- 四張表對應 src/db/schema.ts 的 StoredTask / StoredProject / StoredTag / StoredFilter，
-- 欄位命名與型別刻意跟本地端一致，讓 src/domain/task.ts 既有的 normalize* 函式
-- 可以原封不動拿來驗證從這裡下載回來的資料——遠端資料跨過信任邊界，
-- 待遇跟 IndexedDB、舊版 localStorage、備份檔完全一樣，不需要另外寫一套驗證。
--
-- 日期／時間欄位刻意存成 text 而不是 Postgres 的 date/time：
-- src/domain/dates.ts 開頭整段設計理由就是「本地日期字串、不讓 Date 物件跨界」，
-- 用原生日期型別等於把時區位移的問題請回來。createdAt/updatedAt/completedAt
-- 存 epoch 毫秒（bigint），同樣是跟本地端 1:1，不需要轉換層。
--
-- id 沿用本地端已經在用的 crypto.randomUUID()，不由資料庫配發——
-- 離線建立的資料本地與遠端 id 天生一致，同步時不必做 id 映射。
--
-- user_id 的預設值是 auth.uid()，不是 client 送什麼就存什麼：client 端的
-- src/sync/rowMapping.ts 完全不送這個欄位，讓「這筆資料屬於誰」單純由
-- 請求帶的 JWT 決定，不留一個「client 宣稱自己是誰」的欄位可以造假。
--
-- deleted_at 是墓碑：純 REST 輪詢（不是 Realtime）沒有天生的「這筆被刪了」
-- 事件，硬刪除會讓其他裝置永遠不知道這筆消失過、下次同步時把它當新資料
-- 抓回來。刪除在這裡是「標記 deleted_at」而不是真的 DELETE；SELECT 不過濾
-- 這個欄位，client 端的合併邏輯（src/sync/merge.ts）自己判斷。
-- 代價：墓碑會一直留著，沒有自動清除——這個工具的資料量級（個人的待辦
-- 清單）不值得為此另外做定期清理，先誠實記在這裡，需要時再處理。

create table public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_name text not null,
  is_completed boolean not null default false,
  "order" double precision not null,
  notes text not null default '',
  priority smallint not null default 0,
  due_date text,
  due_time text,
  project_id uuid,
  tag_ids uuid[] not null default '{}',
  parent_id uuid,
  recurrence jsonb,
  completed_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.projects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  "order" double precision not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.tags (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table public.filters (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  query text not null,
  color text not null,
  "order" double precision not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- 拉取（pull）走 updated_at > 游標 的查詢，四張表都需要這個索引。
create index tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index projects_user_updated_idx on public.projects (user_id, updated_at);
create index tags_user_updated_idx on public.tags (user_id, updated_at);
create index filters_user_updated_idx on public.filters (user_id, updated_at);

alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.tags enable row level security;
alter table public.filters enable row level security;

-- 每張表同一組四條 policy：使用者只能碰自己的列。
-- 這是標準的 Supabase 多租戶寫法，也是未來「分享專案給別人」最自然的擴充點——
-- 屆時加一張 project_members，把 using 條件從單一 user_id 改成
-- user_id = auth.uid() OR project_id in (select project_id from project_members where user_id = auth.uid())。
--
-- delete policy 仍然保留，即使 client 端目前只用軟刪除（見上方註解）——
-- 留著才有辦法在資料庫後台或未來的清理工作手動硬刪除，不必再補一條 policy。
do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'projects', 'tags', 'filters']
  loop
    execute format(
      'create policy "select own %1$s" on public.%1$s for select using (user_id = auth.uid())', t
    );
    execute format(
      'create policy "insert own %1$s" on public.%1$s for insert with check (user_id = auth.uid())', t
    );
    execute format(
      'create policy "update own %1$s" on public.%1$s for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t
    );
    execute format(
      'create policy "delete own %1$s" on public.%1$s for delete using (user_id = auth.uid())', t
    );
  end loop;
end $$;
