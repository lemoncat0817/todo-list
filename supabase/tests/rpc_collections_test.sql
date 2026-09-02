-- M1：projects/tags/filters 的 create_*／apply_tag_patch 驗證，
-- 跟 rpc_patch_test.sql 對 tasks 做的事同一套邏輯，這裡只驗證
-- 「這四張表現在真的走同一種規則」，不重複整套權限矩陣。
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@rpc2-test.local', 'x', now(), now(), now(), '{}', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) create_project
select results_eq(
  $$ select name, color from public.create_project('20000000-0000-0000-0000-000000000001',
       jsonb_build_object('id', '00000000-0000-0000-0000-000000000101', 'name', '新專案', 'rank', 'A')) $$,
  $$ values ('新專案'::text, '#1d4ed8'::text) $$,
  'create_project() 建立專案，顏色用預設值');

-- 2) create_tag
select results_eq(
  $$ select name from public.create_tag('20000000-0000-0000-0000-000000000002',
       jsonb_build_object('id', '00000000-0000-0000-0000-000000000102', 'name', '緊急')) $$,
  $$ values ('緊急'::text) $$,
  'create_tag() 建立標籤');

-- 3) create_filter
select results_eq(
  $$ select name, query from public.create_filter('20000000-0000-0000-0000-000000000003',
       jsonb_build_object('id', '00000000-0000-0000-0000-000000000103', 'name', '本週', 'query', 'due:week', 'rank', 'A')) $$,
  $$ values ('本週'::text, 'due:week'::text) $$,
  'create_filter() 建立篩選器');

-- 4) apply_tag_patch 只改 color，name 不受影響
select results_eq(
  $$ select name, color from public.apply_tag_patch('20000000-0000-0000-0000-000000000004',
       '00000000-0000-0000-0000-000000000102', jsonb_build_object('color', '#dc2626')) $$,
  $$ values ('緊急'::text, '#dc2626'::text) $$,
  'apply_tag_patch 只送 color 時，name 不受影響');

-- 5) op_id 去重：create_project 重送同一個 op_id，第二次不會用新 payload 覆蓋
select is(
  (select name from public.create_project('20000000-0000-0000-0000-000000000001',
     jsonb_build_object('id', '00000000-0000-0000-0000-000000000101', 'name', '被重送的名字', 'rank', 'A'))),
  '新專案',
  'create_project 的 op_id 去重生效，重送不會覆蓋原本的名字');

-- 6) 非成員不能對別人的標籤補丁
reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@rpc2-test.local', 'x', now(), now(), now(), '{}', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  $$ select public.apply_tag_patch('20000000-0000-0000-0000-000000000006',
       '00000000-0000-0000-0000-000000000102', jsonb_build_object('color', '#000000')) $$,
  null, null, '非成員呼叫 apply_tag_patch 被 RLS 擋下');
reset role;

select * from finish();
rollback;
