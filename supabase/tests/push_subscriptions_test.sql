-- M4：推播訂閱的 RLS，以及留言 @提及 trigger 在推播還沒設定（Vault
-- 密鑰是預設的空字串佔位值）時不會擋下留言本身。
--
-- 這裡不驗證「trigger 真的呼叫到 edge function、Web Push 真的送達」——
-- 那段用本地 Supabase 搭配真正跑起來的 send-mention-push（`supabase
-- functions serve`）跟手動設定的 Vault 密鑰整條實測過一輪：
-- create_comment 帶 mentioned_user_ids → trigger 讀 Vault → pg_net 呼叫
-- edge function → 真的對 fcm.googleapis.com 送出（用假的訂閱端點，
-- 收到 404 後正確清掉那筆訂閱）。CI 沒有跑起來的 edge function 也沒有
-- 設定 Vault 密鑰，這段沒辦法在 pgTAP 裡重現，留言測試涵蓋的是
-- 「secrets 沒設定時安靜跳過，不會讓留言寫入本身失敗」這個邊界情況。
begin;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@push-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@push-test.local', 'x', now(), now(), now(), '{}', '{}');

-- ------------------------------------------------------ push_subscriptions

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) Alice 可以新增自己的推播訂閱，user_id 由 auth.uid() 決定。
select results_eq(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
       values ('https://fcm.example/ep1', 'p256dh-key', 'auth-key')
     returning user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000a11c'::uuid) $$,
  '新增推播訂閱時 user_id 由 auth.uid() 決定，不採信 client 送的值');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://fcm.example/ep2', 'p256dh-key-2', 'auth-key-2');
reset role;

-- 2) Alice 只看得到自己的訂閱，看不到 Bob 的。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select is(
  (select count(*)::int from public.push_subscriptions),
  1, 'Alice 只看得到自己的推播訂閱，看不到 Bob 的');
reset role;

-- 3) Bob 也一樣只看得到自己的。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.push_subscriptions),
  1, 'Bob 也只看得到自己的推播訂閱');

-- 4) Bob 不能新增別人（Alice）名下的訂閱——user_id 一樣由 auth.uid() 決定，
-- client 送什麼都沒用，這裡驗證的是「送了也沒用」而不是「會被拒絕」。
select results_eq(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth)
       values ('https://fcm.example/ep3', 'p', 'a')
     returning user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000b0b0'::uuid) $$,
  '即使不指定 user_id，新增的訂閱仍然歸屬呼叫者本人（Bob），不是 Alice');
reset role;

-- 5) 非成員之間互相刪不掉對方的訂閱。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
delete from public.push_subscriptions where endpoint = 'https://fcm.example/ep1';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select is(
  (select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.example/ep1'),
  1, 'Bob 刪不掉 Alice 的推播訂閱，Alice 的那筆還在');

-- 6) 本人可以刪除自己的訂閱。
delete from public.push_subscriptions where endpoint = 'https://fcm.example/ep1';
select is(
  (select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.example/ep1'),
  0, 'Alice 可以刪除自己的推播訂閱');
reset role;

-- 7) 同一個 user_id／endpoint 組合不能重複（unique 約束）。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  $$ insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://fcm.example/ep2', 'x', 'y') $$,
  null, null, '同一個使用者對同一個 endpoint 重複訂閱會違反 unique 約束');
reset role;

-- ------------------------------------------------- @提及 trigger 的邊界情況

-- 8) Vault 密鑰是預設的空字串佔位值（migration 剛套用完的狀態）時，
-- 帶 mentioned_user_ids 的留言仍然正常寫入——trigger 安靜跳過推播，
-- 不會讓留言這個動作本身失敗。
insert into public.tasks (id, task_name, is_completed, rank, notes, priority, project_id, tag_ids, created_at, updated_at, user_id)
select '90000000-0000-0000-0000-000000000099', '推播測試任務', false, 'A', '', 0, p.id, '{}', 1, 1, '00000000-0000-0000-0000-00000000a11c'
  from public.projects p
 where p.workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and p.is_inbox;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select lives_ok(
  $$ select public.create_comment('90000000-0000-0000-0000-000000000098',
       jsonb_build_object('id', '90000000-0000-0000-0000-000000000097', 'task_id', '90000000-0000-0000-0000-000000000099',
         'body', '@Bob 這個交給你', 'mentioned_user_ids', jsonb_build_array('00000000-0000-0000-0000-00000000b0b0'))) $$,
  'Vault 密鑰還沒設定時，帶提及的留言仍然正常寫入，不會被 trigger 擋下');
reset role;

select * from finish();
rollback;
