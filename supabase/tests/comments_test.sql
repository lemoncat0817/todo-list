-- M3：任務留言的權限矩陣。can_comment() 這道門檻（commenter 角色以上）
-- 從 0004 就定義好了，這是第一支真正用到它的測試。
begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@comments-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@comments-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c0c0', 'authenticated', 'authenticated', 'commenter@comments-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@comments-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 viewer（能看任務，不能留言）；commenter 使用者是 commenter 角色
-- （能留言，不能寫任務本身）；Carol 完全不是成員。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000c0c0', 'commenter'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

-- 直接建一筆任務當留言的對象——這支測試驗證的是留言本身的規則，
-- 不重複驗證 create_task。
insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at, user_id)
select '40000000-0000-0000-0000-000000000002', '討論這個', false, 'A', '', 0, p.id, '{}', 1, 1, '00000000-0000-0000-0000-00000000a11c'
  from public.projects p
 where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and p.is_inbox;

-- 1) commenter 角色的人可以留言。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0c0","role":"authenticated"}';
select results_eq(
  $$ select body, author_id from public.create_comment('40000000-0000-0000-0000-000000000003',
       jsonb_build_object('id', '40000000-0000-0000-0000-000000000004', 'task_id', '40000000-0000-0000-0000-000000000002', 'body', '第一則留言')) $$,
  $$ values ('第一則留言'::text, '00000000-0000-0000-0000-00000000c0c0'::uuid) $$,
  'commenter 角色可以留言，author_id 由 auth.uid() 決定');
reset role;

-- 2) viewer 角色的 Bob 不能留言。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ select public.create_comment('40000000-0000-0000-0000-000000000005',
       jsonb_build_object('id', '40000000-0000-0000-0000-000000000006', 'task_id', '40000000-0000-0000-0000-000000000002', 'body', 'Bob 想留言')) $$,
  null, null, 'viewer 角色的 Bob 不能留言，can_comment 排除 viewer');
reset role;

-- 3) 非成員的 Carol 看不到留言、也不能建立。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select is(
  (select count(*)::int from public.comments where task_id = '40000000-0000-0000-0000-000000000002'),
  0, '非成員的 Carol 看不到任何留言');
select throws_ok(
  $$ select public.create_comment('40000000-0000-0000-0000-000000000007',
       jsonb_build_object('id', '40000000-0000-0000-0000-000000000008', 'task_id', '40000000-0000-0000-0000-000000000002', 'body', 'Carol 想留言')) $$,
  null, null, '非成員的 Carol 不能建立留言');
reset role;

-- 4) 作者本人可以編輯自己的留言。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0c0","role":"authenticated"}';
select is(
  (select body from public.apply_comment_patch('40000000-0000-0000-0000-000000000009',
     '40000000-0000-0000-0000-000000000004', jsonb_build_object('body', '改過的留言'))),
  '改過的留言',
  '作者可以編輯自己的留言');
reset role;

-- 5) 不是作者的 Alice（即使是工作區 owner）不能編輯別人的留言——
-- UPDATE 的 RLS USING 子句靜默過濾掉不符合的列，不丟例外（跟 0005
-- 測過的 tasks UPDATE 行為一致），所以驗證的是「內容真的沒被改動」。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
update public.comments set body = 'Alice 想偷改' where id = '40000000-0000-0000-0000-000000000004';
reset role;
select is(
  (select body from public.comments where id = '40000000-0000-0000-0000-000000000004'),
  '改過的留言',
  'owner 也不能編輯別人的留言，內容沒被改動');

-- 6) op_id 去重：apply_comment_patch 重送同一個 op_id，不會再套用一次。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0c0","role":"authenticated"}';
select is(
  (select body from public.apply_comment_patch('40000000-0000-0000-0000-000000000009',
     '40000000-0000-0000-0000-000000000004', jsonb_build_object('body', '被重送的內容'))),
  '改過的留言',
  '同一個 op_id 重送不會再套用一次補丁');

-- 7) 作者可以軟刪除自己的留言。
select is(
  (select deleted_at is not null from public.apply_comment_patch('40000000-0000-0000-0000-00000000000a',
     '40000000-0000-0000-0000-000000000004', jsonb_build_object('deleted_at', 12345))),
  true,
  '作者可以軟刪除自己的留言');
reset role;

-- 8) create_comment 帶 mentioned_user_ids：陣列原封不動存進去。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c0c0","role":"authenticated"}';
select results_eq(
  $$ select mentioned_user_ids from public.create_comment('40000000-0000-0000-0000-00000000000b',
       jsonb_build_object('id', '40000000-0000-0000-0000-00000000000c', 'task_id', '40000000-0000-0000-0000-000000000002',
         'body', '@Alice 麻煩看一下', 'mentioned_user_ids', jsonb_build_array('00000000-0000-0000-0000-00000000a11c'))) $$,
  $$ values (array['00000000-0000-0000-0000-00000000a11c']::uuid[]) $$,
  'create_comment() 帶 mentioned_user_ids 時，陣列正確存入');

-- 9) 沒帶 mentioned_user_ids：預設空陣列，不是 null。
select is(
  (select mentioned_user_ids from public.create_comment('40000000-0000-0000-0000-00000000000d',
     jsonb_build_object('id', '40000000-0000-0000-0000-00000000000e', 'task_id', '40000000-0000-0000-0000-000000000002', 'body', '沒有提及任何人'))),
  '{}'::uuid[],
  'create_comment() 沒帶 mentioned_user_ids 時預設空陣列');

-- 10) apply_comment_patch 可以更新 mentioned_user_ids（編輯留言時改了提及對象）。
select is(
  (select mentioned_user_ids from public.apply_comment_patch('40000000-0000-0000-0000-00000000000f',
     '40000000-0000-0000-0000-00000000000c', jsonb_build_object('mentioned_user_ids', jsonb_build_array()))),
  '{}'::uuid[],
  'apply_comment_patch() 可以把 mentioned_user_ids 改成空陣列');
reset role;

select * from finish();
rollback;
