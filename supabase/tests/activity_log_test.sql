-- M3：活動記錄。trigger 產生、使用者唯讀，任何角色都不能直接寫入。
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@activity-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@activity-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@activity-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 viewer（看得到任務，寫不了任務，但活動記錄的可見度只要看得到
-- 任務就夠，不需要能寫）；Carol 完全不是成員。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

insert into public.projects (id, user_id, name, color, rank, workspace_id, updated_at)
values ('50000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-00000000a11c', '第二個專案', '#000', 'A',
  (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

select public.create_task('50000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', '50000000-0000-0000-0000-000000000002', 'task_name', '追蹤這個', 'rank', 'A'));

-- 1) 建立任務會自動留一筆 created。
select is(
  (select kind from public.activity_log where task_id = '50000000-0000-0000-0000-000000000002'),
  'created',
  '建立任務自動留一筆 created');

select public.apply_task_patch('50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('is_completed', true));
select public.apply_task_patch('50000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('is_completed', false));
select public.apply_task_patch('50000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('project_id', '50000000-0000-0000-0000-000000000099'));
select public.apply_task_patch('50000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('notes', '只是隨手記一下，不算事件'));
select public.apply_task_patch('50000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('task_name', '改過的名稱'));
select public.apply_task_patch('50000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000002',
  jsonb_build_object('due_date', '2026-09-04'));

-- 2) 完成／取消完成／換專案／改名稱／改期都各留一筆；只改 notes 不多留任何一筆。
select results_eq(
  $$ select kind from public.activity_log where task_id = '50000000-0000-0000-0000-000000000002' order by created_at $$,
  $$ values ('created'::text), ('completed'::text), ('reopened'::text), ('moved'::text), ('renamed'::text), ('due_changed'::text) $$,
  '完成／取消完成／換專案／改名稱／改期各留一筆，只改 notes 不留痕跡');

-- 3) moved 的 detail 記著換專案前後的 id。
select results_eq(
  $$ select detail->>'from', detail->>'to' from public.activity_log
       where task_id = '50000000-0000-0000-0000-000000000002' and kind = 'moved' $$,
  $$ select (select id from public.projects where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c') and is_inbox)::text,
            '50000000-0000-0000-0000-000000000099'::text $$,
  'moved 的 detail 記著換專案前後的 project id');

-- 4) renamed／due_changed 的 detail 記著變更前後的值。
select results_eq(
  $$ select detail->>'from', detail->>'to' from public.activity_log
       where task_id = '50000000-0000-0000-0000-000000000002' and kind = 'renamed' $$,
  $$ values ('追蹤這個'::text, '改過的名稱'::text) $$,
  'renamed 的 detail 記著改名前後');
select results_eq(
  $$ select detail->>'from', detail->>'to' from public.activity_log
       where task_id = '50000000-0000-0000-0000-000000000002' and kind = 'due_changed' $$,
  $$ values (null::text, '2026-09-04'::text) $$,
  'due_changed 的 detail 記著改期前後');
reset role;

-- 5) viewer 的 Bob 看得到活動記錄（跟能不能寫任務無關，只要看得到任務就夠）。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.activity_log where task_id = '50000000-0000-0000-0000-000000000002'),
  6, 'viewer 的 Bob 看得到全部 6 筆活動記錄');
reset role;

-- 6) 非成員的 Carol 完全看不到。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select is(
  (select count(*)::int from public.activity_log where task_id = '50000000-0000-0000-0000-000000000002'),
  0, '非成員的 Carol 看不到任何活動記錄');
reset role;

-- 7) 沒有人能直接寫入活動記錄，即使是任務的擁有者本人——唯一的寫入路徑是 trigger。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select throws_ok(
  $$ insert into public.activity_log (task_id, kind, detail)
       values ('50000000-0000-0000-0000-000000000002', 'fabricated', '{}'::jsonb) $$,
  null, null, '沒有人能直接寫入活動記錄，唯一路徑是 trigger');
reset role;

select * from finish();
rollback;
