-- M5：區段（看板欄）的 RLS、RPC 補丁，以及區段必須屬於任務所在專案的檢查。
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@sections-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@sections-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d0d0', 'authenticated', 'authenticated', 'dave@sections-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 member（能寫任務／區段）；Dave 是 viewer（能看不能寫）。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'member'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000d0d0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

-- 兩個專案：一個是 Alice 工作區的收件匣（區段的合法歸屬），另一個是
-- 完全獨立、Bob／Dave 都碰不到的其他工作區專案（用來驗證「區段必須
-- 屬於同一個專案」這條規則）。
insert into public.workspaces (id, name, created_by) values ('80000000-0000-0000-0000-0000000000f2', '另一個工作區', '00000000-0000-0000-0000-00000000a11c');
insert into public.projects (id, user_id, name, color, rank, workspace_id, is_inbox, updated_at)
values ('80000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-00000000a11c', '另一個專案', '#000', 'A', '80000000-0000-0000-0000-0000000000f2', false, 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) Bob（member）可以在 Alice 的工作區底下建立區段。
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select results_eq(
  $$ select name from public.create_section('81000000-0000-0000-0000-000000000001',
       (select jsonb_build_object('id', '81000000-0000-0000-0000-000000000002', 'name', '待處理',
          'rank', 'A', 'project_id', p.id::text)
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  $$ values ('待處理'::text) $$,
  'member 角色的 Bob 可以建立區段');

-- 2) viewer 角色的 Dave 不能建立區段。
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d0d0","role":"authenticated"}';
select throws_ok(
  $$ select public.create_section('81000000-0000-0000-0000-000000000003',
       (select jsonb_build_object('id', '81000000-0000-0000-0000-000000000004', 'name', 'Dave 想建的區段',
          'rank', 'B', 'project_id', p.id::text)
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  null, null, 'viewer 角色的 Dave 不能建立區段');

-- 3) Dave 看得到區段（viewer 有 select 權限）。
select is(
  (select count(*)::int from public.sections where name = '待處理'),
  1, 'Dave（viewer）看得到區段');

-- 4) Bob 可以改區段名稱。
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select results_eq(
  $$ select name from public.apply_section_patch('81000000-0000-0000-0000-000000000005',
       '81000000-0000-0000-0000-000000000002', jsonb_build_object('name', '進行中')) $$,
  $$ values ('進行中'::text) $$,
  'Bob 可以改區段名稱');

-- 5) 任務指派到同一個專案底下的區段成功。
select results_eq(
  $$ select section_id from public.create_task('81000000-0000-0000-0000-000000000006',
       (select jsonb_build_object('id', '81000000-0000-0000-0000-000000000007', 'task_name', '看板卡片',
          'rank', 'A', 'project_id', p.id::text, 'section_id', '81000000-0000-0000-0000-000000000002')
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  $$ values ('81000000-0000-0000-0000-000000000002'::uuid) $$,
  '任務指派到同一個專案底下的區段成功');

-- 6) 任務指派到別的專案的區段（這裡直接用一個不存在同專案的假 id 模擬
-- 「區段屬於別的專案」）會被 validate_task_section 擋下。先以
-- superuser 身分建一個屬於「另一個專案」的區段——Bob 不是那個工作區的
-- 成員，用他的身分建不起來，這裡要測的是 trigger 而不是 RLS。
reset role;
insert into public.sections (id, project_id, name, rank, created_at, updated_at)
values ('81000000-0000-0000-0000-000000000099', '80000000-0000-0000-0000-000000000f02', '別的專案的區段', 'A', 1, 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_task_patch('81000000-0000-0000-0000-000000000008',
       '81000000-0000-0000-0000-000000000007', jsonb_build_object('section_id', '81000000-0000-0000-0000-000000000099')) $$,
  null, null, '指派到別的專案的區段會被擋下');

-- 7) 被擋下的補丁不影響原本的 section_id。
select results_eq(
  $$ select section_id from public.tasks where id = '81000000-0000-0000-0000-000000000007' $$,
  $$ values ('81000000-0000-0000-0000-000000000002'::uuid) $$,
  '被擋下的補丁不會改到原本的區段指派');

-- 8) 補丁沒帶 section_id 這個鍵時維持原值不動。
select results_eq(
  $$ select section_id from public.apply_task_patch('81000000-0000-0000-0000-00000000000a',
       '81000000-0000-0000-0000-000000000007', jsonb_build_object('notes', '改個備註')) $$,
  $$ values ('81000000-0000-0000-0000-000000000002'::uuid) $$,
  '補丁沒帶 section_id 鍵時維持原本的區段不動');

-- 9) 補丁明確帶 null，取消區段指派（移出看板欄）。
select results_eq(
  $$ select section_id from public.apply_task_patch('81000000-0000-0000-0000-00000000000b',
       '81000000-0000-0000-0000-000000000007', jsonb_build_object('section_id', null)) $$,
  $$ values (null::uuid) $$,
  '補丁明確帶 section_id: null 可以取消區段指派');

-- 10) Bob 可以刪除區段（軟刪除：apply_section_patch 帶 deleted_at）。
select results_eq(
  $$ select deleted_at is not null from public.apply_section_patch('81000000-0000-0000-0000-00000000000c',
       '81000000-0000-0000-0000-000000000002', jsonb_build_object('deleted_at', 1700000000000)) $$,
  $$ values (true) $$,
  'Bob 可以刪除（軟刪除）區段');

reset role;

select * from finish();
rollback;
