-- M3：任務留言。第一塊真正的協作內容（前面 M0-M2 都還是「誰能碰到誰的
-- 東西」，留言是第一個「多人在同一筆任務上留下彼此看得到的紀錄」）。
--
-- 權限刻意用 can_comment()（0004 就定義好了，一直沒有東西在用）而不是
-- can_write_task()：commenter 角色的人本來就是設計成「能討論、不能改
-- 任務本身」，留言正是這個角色唯一該有的能力。
--
-- 只有作者本人能編輯／刪除自己的留言——不做「admin 可以刪除別人留言」
-- 這種管理機制，這個工具的量級（小團隊的待辦協作）不需要，需要時再加，
-- 不是先幫使用者決定好一套審核制度。
--
-- 沒有 workspace_id 欄位：留言永遠依附於一筆任務，可見性／寫入權限
-- 全部透過 join tasks 判斷（can_comment 讀的是 tasks.project_id），
-- 不需要另外快取一份 workspace_id——不像 tasks 表本身需要 workspace_id
-- 是因為它是「同步輪詢要抓哪些列」的直接篩選欄位，留言的父層任務
-- 已經扛下這個責任了。
create table public.comments (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index comments_task_idx on public.comments (task_id);

alter table public.comments enable row level security;

-- select：跟 tasks_select 用的是同一顆 can_write_task 系列的判斷式，
-- 只是門檻換成 can_comment（多了 commenter 角色）。
create policy comments_select on public.comments
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.can_comment(t.project_id))
  );

create policy comments_insert on public.comments
  for insert with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.can_comment(t.project_id))
  );

-- update／delete 都只認作者本人——不查 can_comment，因為一個人不論角色
-- 有沒有降級，都該還能修正／收回自己說過的話；但不能動別人的留言。
create policy comments_update on public.comments
  for update using (author_id = (select auth.uid()))
          with check (author_id = (select auth.uid()));

-- 沒有 comments_delete policy：跟 tasks/projects 一樣走軟刪除
-- （update 設 deleted_at），硬 DELETE 這條路徑本來就不開放。

-- create_comment／apply_comment_patch：跟 create_task／apply_task_patch
-- 同一套 op_id 去重 + 欄位補丁邏輯，只是留言可編輯的欄位只有 body 一個，
-- 補丁函式因此比其他幾支都精簡。
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

  insert into public.comments (id, task_id, body, created_at, updated_at)
  values (
    (p_row->>'id')::uuid,
    (p_row->>'task_id')::uuid,
    p_row->>'body',
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.apply_comment_patch(p_op_id uuid, p_comment_id uuid, p_patch jsonb)
returns public.comments
language plpgsql
as $$
declare
  v_row public.comments;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.comments where id = p_comment_id;
    return v_row;
  end if;

  update public.comments c set
    body         = coalesce(p_patch->>'body', c.body),
    deleted_at   = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else c.deleted_at end,
    updated_at   = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where c.id = p_comment_id
  returning * into v_row;

  if not found then
    raise exception '留言 % 不存在或沒有寫入權限', p_comment_id;
  end if;
  return v_row;
end;
$$;
