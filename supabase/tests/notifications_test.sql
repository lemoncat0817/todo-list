-- M4 剩餘部分：通知中心、每類通知的偏好設定、每日摘要信排程骨架。
begin;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@notif-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@notif-test.local', 'x', now(), now(), now(), '{}', '{}');

insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'member'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) Alice 建立任務並指派給 Bob，Bob 收到一筆 kind = 'assignment' 的通知。
select results_eq(
  $$ select assignee_id from public.create_task('60000000-0000-0000-0000-000000000001',
       (select jsonb_build_object('id', '60000000-0000-0000-0000-000000000002', 'task_name', '寫週報',
          'rank', 'A', 'project_id', p.id::text, 'assignee_id', '00000000-0000-0000-0000-00000000b0b0')
          from public.projects p
         where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
           and p.is_inbox)) $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  '建立任務時指派給 Bob 成功');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select results_eq(
  $$ select kind, task_id from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0' $$,
  $$ values ('assignment'::text, '60000000-0000-0000-0000-000000000002'::uuid) $$,
  'Bob 收到一筆指派通知，task_id 對得上');
reset role;

-- 2) Alice 看不到 Bob 的通知（RLS 只認 user_id）。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications),
  0, 'Alice 看不到任何通知——這一筆是 Bob 的');
reset role;

-- 3) Bob 可以把自己的通知標成已讀。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
update public.notifications set read_at = 1700000000000
 where user_id = '00000000-0000-0000-0000-00000000b0b0';
select is(
  (select read_at from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0'),
  1700000000000::bigint, 'Bob 可以把自己的通知標成已讀');
reset role;

-- 4) 指派給自己不會產生通知（不必通知自己）。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select public.apply_task_patch('60000000-0000-0000-0000-000000000003',
  '60000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000a11c'));
select is(
  (select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-00000000a11c'),
  0, '指派給自己不會產生通知');
reset role;

-- 5) Bob 關閉「被指派」的通知偏好後，再被指派不會再收到新通知。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
insert into public.notification_prefs (user_id, notify_on_assignment) values ('00000000-0000-0000-0000-00000000b0b0', false);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
-- 先改別人（Alice 自己）騰出指派欄位，再指回 Bob，觸發第二次「指派給 Bob」事件。
select public.apply_task_patch('60000000-0000-0000-0000-000000000004',
  '60000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000a11c'));
select public.apply_task_patch('60000000-0000-0000-0000-000000000005',
  '60000000-0000-0000-0000-000000000002', jsonb_build_object('assignee_id', '00000000-0000-0000-0000-00000000b0b0'));
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0'),
  1, '關閉指派通知偏好後，再次被指派不會多出新的通知（還是原本那一筆）');
reset role;

-- 6) Bob 可以刪除自己的通知。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
delete from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0';
select is(
  (select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0'),
  0, 'Bob 可以刪除自己的通知');
reset role;

-- 7) notification_prefs 的 RLS：只能看到／改到自己的偏好列。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
insert into public.notification_prefs (user_id, notify_on_mention) values ('00000000-0000-0000-0000-00000000a11c', false);
select is(
  (select count(*)::int from public.notification_prefs),
  1, 'Alice 只看得到自己的偏好列，看不到 Bob 的');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ insert into public.notification_prefs (user_id, notify_on_mention) values ('00000000-0000-0000-0000-00000000a11c', true) $$,
  null, null, 'Bob 不能新增／冒充 Alice 的偏好列');
reset role;

-- 8) @提及仍然正常寫進通知中心（跟指派共用同一套 notify_user()）。
insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at, user_id)
select '60000000-0000-0000-0000-000000000099', '留言測試任務', false, 'A', '', 0, p.id, '{}', 1, 1, '00000000-0000-0000-0000-00000000a11c'
  from public.projects p
 where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and p.is_inbox;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select public.create_comment('60000000-0000-0000-0000-000000000006',
  jsonb_build_object('id', '60000000-0000-0000-0000-000000000007', 'task_id', '60000000-0000-0000-0000-000000000099',
    'body', '@Bob 麻煩看一下', 'mentioned_user_ids', jsonb_build_array('00000000-0000-0000-0000-00000000b0b0')));
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-00000000b0b0' and kind = 'mention'),
  1, '@提及一樣會進 Bob 的通知中心');
reset role;

-- 9) 每日摘要的排程函式在密鑰還沒設定（migration 剛套用完的預設狀態）
-- 時安靜跳過，不會噴錯。
select lives_ok(
  $$ select public.trigger_daily_digest() $$,
  '每日摘要密鑰還沒設定時，trigger_daily_digest() 安靜跳過，不會失敗');

-- 10) 排程本身真的存在，且是每天一次。
select is(
  (select schedule from cron.job where jobname = 'daily-digest'),
  '0 9 * * *', '每日摘要排程確實已註冊，時間是每天 09:00');

select * from finish();
rollback;
