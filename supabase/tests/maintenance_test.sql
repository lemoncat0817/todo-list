-- M6：韌性與規模——裝置游標、墓碑／processed_ops 清理、寫入速率限制、
-- 附件的工作區儲存配額。
begin;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@maint-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@maint-test.local', 'x', now(), now(), now(), '{}', '{}');

-- ------------------------------------------------------------ device_cursors

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) Alice 可以註冊自己的裝置游標。
select lives_ok(
  $$ insert into public.device_cursors (device_id, user_id, last_synced_at)
       values ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a11c', 1000) $$,
  'Alice 可以新增自己的裝置游標');
reset role;

-- 2) Bob 新增別人（Alice）名下的裝置游標會被 RLS 擋下。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ insert into public.device_cursors (device_id, user_id, last_synced_at)
       values ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a11c', 1000) $$,
  null, null, 'Bob 不能冒充 Alice 新增裝置游標');
reset role;

-- 3) Bob 看不到 Alice 的裝置游標。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.device_cursors),
  0, 'Bob 看不到 Alice 的裝置游標');
reset role;

-- 4) min_device_cursor()：只有 Alice 一台裝置時，回傳她的游標值。
select is(public.min_device_cursor(), 1000::bigint, 'min_device_cursor 回傳唯一裝置的游標值');

-- 5) Bob 也註冊一台，游標比較舊——min_device_cursor 要跟著變小。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
insert into public.device_cursors (device_id, user_id, last_synced_at)
  values ('90000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000b0b0', 500);
reset role;
select is(public.min_device_cursor(), 500::bigint, '多台裝置時取最舊的那個游標');

-- ------------------------------------------------------- 清理：processed_ops

-- 6) 30 天前的 processed_ops 會被清掉，近期的留著。
insert into public.processed_ops (op_id, actor_id, created_at)
values
  ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a11c', now() - interval '40 days'),
  ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a11c', now() - interval '1 day');

select public.cleanup_stale_ops_and_tombstones();

select is(
  (select count(*)::int from public.processed_ops where op_id = '91000000-0000-0000-0000-000000000001'),
  0, '超過 30 天的 processed_ops 被清掉');
select is(
  (select count(*)::int from public.processed_ops where op_id = '91000000-0000-0000-0000-000000000002'),
  1, '30 天內的 processed_ops 還在');

-- ---------------------------------------------------------- 清理：墓碑

-- 7) 遠早於 90 天、且所有裝置都已經同步過（min_device_cursor = 500）的
-- 墓碑會被清掉；即使超過 90 天，但比目前的 min_device_cursor（500）還
-- 新的墓碑要保留——代表還有裝置沒同步到那個時間點。
insert into public.tags (id, user_id, name, color, updated_at, deleted_at)
values
  ('92000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a11c', '', '', 100, 100),
  ('92000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a11c', '', '', 800, 800);

select public.cleanup_stale_ops_and_tombstones();

select is(
  (select count(*)::int from public.tags where id = '92000000-0000-0000-0000-000000000001'),
  0, '早於所有裝置游標的墓碑被清掉');
select is(
  (select count(*)::int from public.tags where id = '92000000-0000-0000-0000-000000000002'),
  1, '晚於某台裝置游標的墓碑保留（那台裝置還沒同步過這個時間點）');

-- ----------------------------------------------------------------- 速率限制

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 8) 短時間內插入超過門檻筆數的 processed_ops 會被整批擋下。
select throws_ok(
  $$ insert into public.processed_ops (op_id, actor_id)
       select gen_random_uuid(), '00000000-0000-0000-0000-00000000a11c' from generate_series(1, 305) $$,
  'P0001', '寫入速率過高，請稍後再試',
  '短時間內插入超過門檻的 processed_ops 會被擋下');

-- 9) 門檻之內的量正常成功。
select lives_ok(
  $$ insert into public.processed_ops (op_id, actor_id)
       select gen_random_uuid(), '00000000-0000-0000-0000-00000000a11c' from generate_series(1, 50) $$,
  '門檻之內的操作量不受影響');
reset role;

-- ----------------------------------------------------------------- 儲存配額

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 10) workspace_storage_used 對非成員拋出例外，不會洩漏用量數字。
select throws_ok(
  $$ select public.workspace_storage_used('80000000-0000-0000-0000-000000000f99') $$,
  null, null, 'workspace_storage_used 對非成員的工作區拋出例外');

-- 11) 對自己的工作區回傳目前用量（一開始是 0）。
select is(
  (select public.workspace_storage_used(id) from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'),
  0::bigint, '還沒有附件時用量是 0');

-- 12) 建一筆任務跟一筆在配額內的附件，成功；用量正確反映。
insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at, user_id)
select '93000000-0000-0000-0000-000000000001', '配額測試任務', false, 'A', '', 0, p.id, '{}', 1, 1, '00000000-0000-0000-0000-00000000a11c'
  from public.projects p
 where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and p.is_inbox;

select lives_ok(
  $$ insert into public.attachments (id, task_id, storage_path, file_name, file_size, content_type, created_at, updated_at)
       values ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001', 'x', 'x.pdf', 1000, 'application/pdf', 1, 1) $$,
  '配額內的附件正常新增');

select is(
  (select public.workspace_storage_used(id) from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'),
  1000::bigint, '用量正確反映剛新增的附件大小');

-- 13) 超過配額（500MB）的附件被擋下。
select throws_ok(
  $$ insert into public.attachments (id, task_id, storage_path, file_name, file_size, content_type, created_at, updated_at)
       values ('93000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000001', 'y', 'y.pdf',
               524288001, 'application/pdf', 1, 1) $$,
  null, null, '超過工作區配額的附件被擋下');

reset role;

select * from finish();
rollback;
