-- M3：附件。metadata 表跟 storage.objects 上的 RLS 分開測——storage.objects
-- 這裡直接用 SQL 操作（不是真的丟檔案位元組），因為 Storage API 最終
-- 也只是對這張表做一般的 INSERT/SELECT/DELETE，RLS 判斷邏輯跟真的
-- 丟檔案打 HTTP API 是同一套。開發時另外用本地 Storage 搭配手動簽署
-- 的 JWT 對真正的 HTTP API 實測過一輪（上傳／下載／越權全部驗證），
-- 這裡補的是可以隨著每次改動重跑的迴歸測試。
begin;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@attachments-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@attachments-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@attachments-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 viewer（看得到，寫不了）；Carol 完全不是成員。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at, user_id)
select '70000000-0000-0000-0000-000000000002', '附件測試任務', false, 'A', '', 0, p.id, '{}', 1, 1, '00000000-0000-0000-0000-00000000a11c'
  from public.projects p
 where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and p.is_inbox;

-- ---------------------------------------------------- attachments 表

-- 1) Alice（owner，can_write_task 通過）可以新增附件 metadata。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select results_eq(
  $$ insert into public.attachments (id, task_id, file_name, file_size, content_type, storage_path)
       values ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'a.txt', 10, 'text/plain',
               '70000000-0000-0000-0000-000000000002/a.txt')
     returning file_name $$,
  $$ values ('a.txt'::text) $$,
  'can_write_task 的 Alice 可以新增附件 metadata');
reset role;

-- 2) viewer 的 Bob 不能新增附件 metadata。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ insert into public.attachments (id, task_id, file_name, file_size, content_type, storage_path)
       values ('70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'b.txt', 10, 'text/plain',
               '70000000-0000-0000-0000-000000000002/b.txt') $$,
  null, null, 'viewer 角色的 Bob 不能新增附件 metadata');
-- 3) 但 Bob 看得到已經存在的附件 metadata。
select is(
  (select count(*)::int from public.attachments where task_id = '70000000-0000-0000-0000-000000000002'),
  1, 'viewer 的 Bob 看得到附件 metadata');
reset role;

-- 4) 非成員的 Carol 完全看不到、也不能新增。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select is(
  (select count(*)::int from public.attachments where task_id = '70000000-0000-0000-0000-000000000002'),
  0, '非成員的 Carol 看不到附件 metadata');
select throws_ok(
  $$ insert into public.attachments (id, task_id, file_name, file_size, content_type, storage_path)
       values ('70000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000002', 'c.txt', 10, 'text/plain',
               '70000000-0000-0000-0000-000000000002/c.txt') $$,
  null, null, '非成員的 Carol 不能新增附件 metadata');
reset role;

-- 5) 軟刪除：can_write_task 的人可以刪除任何一筆附件，不限上傳者本人——
-- 附件是任務內容，不是個人發言，跟留言「只有作者能刪」刻意不同。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
update public.attachments set deleted_at = 12345 where id = '70000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select deleted_at from public.attachments where id = '70000000-0000-0000-0000-000000000001'),
  12345::bigint, 'can_write_task 的人可以軟刪除任何一筆附件（不限上傳者本人）');

-- 6) viewer 的 Bob 不能軟刪除——UPDATE 的 RLS USING 靜默過濾掉不符合的
-- 列，不丟例外（跟其他表已經驗證過的 UPDATE 行為一致），驗證內容沒被改動。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
update public.attachments set deleted_at = null where id = '70000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select deleted_at from public.attachments where id = '70000000-0000-0000-0000-000000000001'),
  12345::bigint, 'viewer 的 Bob 不能軟刪除附件，內容沒被改動');

-- ------------------------------------------------------- storage.objects

-- 7) Alice（can_write_task）可以在這筆任務的資料夾底下新增一筆物件。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
       values ('attachments', '70000000-0000-0000-0000-000000000002/a.txt', '00000000-0000-0000-0000-00000000a11c') $$,
  'can_write_task 的 Alice 可以在任務資料夾底下新增物件');
reset role;

-- 8) viewer 的 Bob 不能新增物件。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
       values ('attachments', '70000000-0000-0000-0000-000000000002/b.txt', '00000000-0000-0000-0000-00000000b0b0') $$,
  null, null, 'viewer 角色的 Bob 不能新增物件');

-- 9) 但 Bob 看得到（下載得到）已經存在的物件——跟 metadata 表的可見度門檻一致。
select is(
  (select count(*)::int from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt'),
  1, 'viewer 的 Bob 看得到（下載得到）已存在的物件');
reset role;

-- 10) 非成員的 Carol 看不到、也不能新增物件。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt'),
  0, '非成員的 Carol 看不到任何物件');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
       values ('attachments', '70000000-0000-0000-0000-000000000002/c.txt', '00000000-0000-0000-0000-00000000ca20') $$,
  null, null, '非成員的 Carol 不能新增物件');
reset role;

-- 11) can_write_task 的 Alice 可以刪除物件；viewer 的 Bob 不行。
-- storage.objects 有一個 protect_delete() 的 trigger，直接 DELETE 預設
-- 一律擋下（連 RLS 都還沒判斷到就先擋），要先設定
-- storage.allow_delete_query 這個 session GUC 才會放行到 RLS 那一層去
-- 判斷——真正的 Storage API 內部就是這樣做的，這裡照樣模擬，不然
-- 測到的是這個 trigger 本身而不是 RLS policy。
set local storage.allow_delete_query = 'true';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
delete from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt'),
  1, 'viewer 的 Bob 刪不掉物件，物件還在');

set local storage.allow_delete_query = 'true';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
delete from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'attachments' and name = '70000000-0000-0000-0000-000000000002/a.txt'),
  0, 'can_write_task 的 Alice 可以刪除物件');

select * from finish();
rollback;
