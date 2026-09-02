-- M1 的欄位補丁 RPC 驗證：只改動補丁裡出現的欄位、op_id 去重、
-- null 清空跟「完全沒送」要能區分、tag_ids 清空不能違反 not null。
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@rpc-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@rpc-test.local', 'x', now(), now(), now(), '{}', '{}');

insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'viewer'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

select id as alice_inbox
  from public.projects
 where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and is_inbox \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) create_task：透過 RPC 新建一筆任務，帶著 due_date/tag_ids。
-- alice_inbox 是 \gset 出來的真實 id，不能直接寫進 $$ 字面字串（psql
-- 的 :'var' 代換不會進到 dollar-quote 裡面），先用 format() 組出完整
-- SQL 文字再 \gset 一次。
select format($fmt$ select (public.create_task(
  '10000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', '00000000-0000-0000-0000-000000000001', 'task_name', '原始名稱',
    'rank', 'A', 'project_id', %L, 'due_date', '2026-01-01', 'tag_ids', jsonb_build_array())
)).task_name $fmt$, :'alice_inbox') as create_sql \gset

select results_eq(
  :'create_sql',
  $$ values ('原始名稱'::text) $$,
  'create_task() 建立任務，欄位如預期');

-- 2) apply_task_patch 只送 notes，task_name/due_date 應該維持不變。
select results_eq(
  $$ select task_name, notes, due_date from public.apply_task_patch(
       '10000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-000000000001',
       jsonb_build_object('notes', '只改備註')
     ) $$,
  $$ values ('原始名稱'::text, '只改備註'::text, '2026-01-01'::text) $$,
  '補丁只送 notes 時，task_name／due_date 不受影響');

-- 3) 送 due_date: null（明確清空）要真的變成 null，不是被 coalesce 擋掉。
select is(
  (select due_date from public.apply_task_patch(
     '10000000-0000-0000-0000-000000000003',
     '00000000-0000-0000-0000-000000000001',
     jsonb_build_object('due_date', null))),
  null,
  '明確送 due_date: null 會真的清空，不是被當成沒送');

-- 4) tag_ids 清空成空陣列不能違反 not null 約束。
select lives_ok(
  $$ select public.apply_task_patch(
       '10000000-0000-0000-0000-000000000004',
       '00000000-0000-0000-0000-000000000001',
       jsonb_build_object('tag_ids', jsonb_build_array())) $$,
  'tag_ids 清空成空陣列不會違反 not null 約束');
select is(
  (select array_length(tag_ids, 1) from public.tasks where id = '00000000-0000-0000-0000-000000000001'),
  null,
  'tag_ids 清空後長度為 0（array_length 對空陣列回傳 null 是正常的）');

-- 5) op_id 去重：同一個 op_id 重送兩次，第二次不會再套用一次補丁
-- （用 rank 這個欄位驗證：如果套用了兩次，會變成第二次送的值）。
select public.apply_task_patch('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001',
  jsonb_build_object('rank', 'X'));
select is(
  (select rank from public.apply_task_patch('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001',
     jsonb_build_object('rank', 'Y'))),
  'X',
  '同一個 op_id 重送第二次不會再套用一次補丁（去重生效）');

-- 6) apply_project_patch 只改 name，color 應該維持不變。
select results_eq(
  format($$ select name, color from public.apply_project_patch(
       '10000000-0000-0000-0000-000000000006', %L, jsonb_build_object('name', '改名後')) $$, :'alice_inbox'),
  $$ values ('改名後'::text, '#6b7280'::text) $$,
  'apply_project_patch 只送 name 時，color 不受影響');

reset role;

-- 7) 非成員直接呼叫 RPC：底層 UPDATE 被 RLS 擋下，函式回報「不存在或沒有寫入權限」。
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@rpc-test.local', 'x', now(), now(), now(), '{}', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_task_patch('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001',
       jsonb_build_object('notes', 'Carol 想改')) $$,
  null, null, '非成員呼叫 apply_task_patch 被 RLS 擋下，函式丟出例外而不是靜默成功');
reset role;

-- 8) viewer 的 Bob 一樣被擋下。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_task_patch('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001',
       jsonb_build_object('notes', 'Bob 想改')) $$,
  null, null, 'viewer 的 Bob 呼叫 apply_task_patch 也被擋下');
reset role;

-- 9) processed_ops 不會把別人的紀錄洩漏出去。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.processed_ops where op_id = '10000000-0000-0000-0000-000000000001'),
  0, 'Bob 看不到 Alice 的 processed_ops 紀錄');
reset role;

select * from finish();
rollback;
