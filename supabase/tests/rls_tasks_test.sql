-- M0 的 RLS／trigger 行為驗證。整個檔案在一個交易裡跑完就 rollback，
-- 測試資料（含塞進 auth.users 的假使用者）不會留下痕跡。
--
-- 不用 supabase_test_helpers 的 tests.* 輔助函式——本地與 CI 的
-- Postgres image 沒有預裝這個 extension，直接操作 auth.users 加上
-- set role / request.jwt.claims 模擬不同使用者的 session，跟
-- PostgREST 收到請求後實際做的事一致。
begin;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@rls-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@rls-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@rls-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 Alice 工作區的 viewer，Carol 完全不是任何人的成員。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

-- 1) 新使用者的 signup trigger 建齊四件事，不需要前端另外呼叫任何 API。
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000a11c'),
  1, 'handle_new_user() 建立 profile');
select is(
  (select count(*)::int from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c' and is_personal),
  1, 'handle_new_user() 建立個人工作區');
select is(
  (select role::text from public.workspace_members
    where user_id = '00000000-0000-0000-0000-00000000a11c'
      and workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')),
  'owner', 'handle_new_user() 把建立者設為 owner');
select is(
  (select count(*)::int from public.projects
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
      and is_inbox),
  1, 'handle_new_user() 建立收件匣專案');

-- 收件匣專案的 id 是 gen_random_uuid()，不是固定值。用 psql 變數把它記下來，
-- 這樣後面切換到 Carol／Bob 的 session（他們對這張表的 select 受 RLS
-- 限制）還能引用同一個真實 id，不需要靠他們自己看不看得到來取值。
select id as alice_inbox
  from public.projects
 where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and is_inbox \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 2) 舊版前端風格的 insert（不帶 project_id）落進收件匣，不是被拒絕。
select lives_ok(
  $$ insert into public.tasks (id, task_name, is_completed, rank, notes, priority, tag_ids, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000001', '舊前端任務', false, 'A', '', 0, '{}', 1, 1) $$,
  '不帶 project_id 的 insert 不會被 RLS 擋下');
select is(
  (select project_id from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  (select id from public.projects where workspace_id = (select public.personal_workspace_id('00000000-0000-0000-0000-00000000a11c')) and is_inbox),
  '未帶 project_id 的任務自動歸到收件匣');

reset role;

-- 3) 完全非成員的 Carol：連 select 都看不到，insert 直接被 RLS 拒絕。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';

select is(
  (select count(*)::int from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  0, '非成員的 Carol 看不到 Alice 的任務');
-- format() 在這裡先把真實的 project id 內插成字面值再交給 throws_ok，
-- 不能直接寫成子查詢——Carol 對 projects 的 select 本來就被 RLS 擋住，
-- 子查詢在她的 session 裡永遠只會查到 null，等於沒測到真正想測的東西。
select format($fmt$ insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000002', 'x', false, 'A', '', 0, %L, '{}', 1, 1) $fmt$, :'alice_inbox') as carol_insert_sql \gset

select throws_ok(:'carol_insert_sql', null, null, 'Carol 想寫進 Alice 的收件匣被拒');

reset role;

-- 4) Bob 是 viewer：能 select、不能 insert/update，能力邊界跟角色矩陣一致。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

select is(
  (select count(*)::int from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  1, 'viewer 的 Bob 看得到 Alice 的任務');
select throws_ok(
  $$ insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000003', 'Bob 想寫', false, 'A', '', 0,
             (select project_id from public.tasks where id = '00000000-0000-0000-0000-000000000001'), '{}', 1, 1) $$,
  null, null, 'viewer 的 Bob 不能新增任務');
-- UPDATE 的 RLS USING 子句過濾掉不符合的列時是靜默影響 0 列，不會像
-- INSERT 的 WITH CHECK 失敗那樣丟例外——所以這裡不能用 throws_ok，
-- 改成執行後直接確認資料真的沒被動到。
update public.tasks set is_completed = true where id = '00000000-0000-0000-0000-000000000001';
select is(
  (select is_completed from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  false, 'viewer 的 Bob 更新不到任何列，任務狀態沒被改動');
select throws_ok(
  $$ insert into public.projects (id, user_id, name, color, rank, workspace_id, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-00000000b0b0', '新專案', '#000', 'A',
             (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 1) $$,
  null, null, 'viewer 的 Bob 不能新建專案');

reset role;

-- 5) 收件匣專案不能被刪，即使是 owner 本人。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

select throws_ok(
  $$ delete from public.projects
      where workspace_id = (select public.personal_workspace_id('00000000-0000-0000-0000-00000000a11c'))
        and is_inbox $$,
  null, null, 'owner 也不能刪除自己的收件匣專案');

-- 6) project_members 的專案層級覆蓋優先於 workspace 層級角色：
-- 把 Bob 在「這一個專案」單獨升成 member，即使他在工作區仍是 viewer。
select lives_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ((select id from public.projects where workspace_id = (select public.personal_workspace_id('00000000-0000-0000-0000-00000000a11c')) and is_inbox),
             '00000000-0000-0000-0000-00000000b0b0', 'member') $$,
  '把 Bob 在單一專案覆蓋成 member');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select lives_ok(
  $$ insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000004', 'Bob 被覆蓋成 member 後可以寫', false, 'A', '', 0,
             (select id from public.projects where workspace_id = (select public.personal_workspace_id('00000000-0000-0000-0000-00000000a11c')) and is_inbox),
             '{}', 1, 1) $$,
  'project_members 覆蓋生效：Bob 在這個專案能寫任務了');
reset role;

select * from finish();
rollback;
