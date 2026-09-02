-- M3 補做：任務指派給單一負責人。驗證重點：
--   1) 指派給工作區成員成功，assignee_id 正確落地（create_task／apply_task_patch）
--   2) 指派給非成員被 validate_task_assignee trigger 擋下
--   3) 補丁沒帶 assignee_id 時維持原值不動（跟 due_date 同一套 `?` 判斷）
--   4) 補丁明確帶 null 時可以取消指派
begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@assignee-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@assignee-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@assignee-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 Alice 工作區的成員；Carol 完全不是成員。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'member'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) 建立任務時直接指派給成員 Bob，成功落地。
select results_eq(
  $$ select assignee_id from public.create_task('50000000-0000-0000-0000-000000000001',
       (select jsonb_build_object('id', '50000000-0000-0000-0000-000000000002', 'task_name', '指派給 Bob',
          'rank', 'A', 'project_id', p.id::text, 'assignee_id', '00000000-0000-0000-0000-00000000b0b0')
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  '建立任務時指派給工作區成員 Bob，assignee_id 正確落地');

-- 2) 建立任務時指派給非成員 Carol，被 trigger 擋下。
select throws_ok(
  $$ select public.create_task('50000000-0000-0000-0000-000000000003',
       (select jsonb_build_object('id', '50000000-0000-0000-0000-000000000004', 'task_name', '指派給 Carol',
          'rank', 'B', 'project_id', p.id::text, 'assignee_id', '00000000-0000-0000-0000-00000000ca20')
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  null, null, '指派給非成員 Carol 會被 validate_task_assignee 擋下');

-- 3) apply_task_patch 補丁指派給成員 Bob，成功。
select results_eq(
  $$ select assignee_id from public.apply_task_patch('50000000-0000-0000-0000-000000000005',
       '50000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000b0b0')) $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  'apply_task_patch 補丁指派給 Bob 成功');

-- 4) 補丁指派給非成員 Carol，被擋下，原本的指派（Bob）不受影響。
select throws_ok(
  $$ select public.apply_task_patch('50000000-0000-0000-0000-000000000006',
       '50000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000ca20')) $$,
  null, null, '補丁指派給非成員 Carol 會被擋下');
select results_eq(
  $$ select assignee_id from public.tasks where id = '50000000-0000-0000-0000-000000000002' $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  '被擋下的補丁不會改到原本的指派');

-- 5) 補丁沒帶 assignee_id 這個鍵時，維持原值不動（跟 due_date 同一套判斷）。
select results_eq(
  $$ select assignee_id from public.apply_task_patch('50000000-0000-0000-0000-000000000007',
       '50000000-0000-0000-0000-000000000002', jsonb_build_object('notes', '改個備註')) $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  '補丁沒帶 assignee_id 鍵時維持原本的指派不動');

-- 6) 補丁明確帶 null，取消指派。
select results_eq(
  $$ select assignee_id from public.apply_task_patch('50000000-0000-0000-0000-000000000008',
       '50000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', null)) $$,
  $$ values (null::uuid) $$,
  '補丁明確帶 assignee_id: null 可以取消指派');

reset role;

select * from finish();
rollback;
