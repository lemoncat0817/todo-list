-- 0029：collections 三張表的 apply_*_patch 必須真的寫入 deleted_at，
-- 且 member 角色刪標籤／篩選器要過 RLS（跟 0005 的權限矩陣一致）。
begin;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@col-del.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@col-del.local', 'x', now(), now(), now(), '{}', '{}');

insert into public.workspaces (id, name, is_personal, created_by, updated_at)
values ('29000000-0000-0000-0000-000000000001', '共享工作區', false, '00000000-0000-0000-0000-00000000a11c', 1);
insert into public.workspace_members (workspace_id, user_id, role) values
  ('29000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a11c', 'owner'),
  ('29000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca20', 'member');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

select results_eq(
  $$ select name from public.create_tag('29000000-0000-0000-0000-000000000011',
       jsonb_build_object('id', '29000000-0000-0000-0000-000000000101', 'name', '緊急',
         'workspace_id', '29000000-0000-0000-0000-000000000001')) $$,
  $$ values ('緊急'::text) $$,
  'owner 在共享工作區建立標籤');

select results_eq(
  $$ select name from public.create_filter('29000000-0000-0000-0000-000000000012',
       jsonb_build_object('id', '29000000-0000-0000-0000-000000000102', 'name', '本週', 'query', 'due:week',
         'rank', 'A', 'workspace_id', '29000000-0000-0000-0000-000000000001')) $$,
  $$ values ('本週'::text) $$,
  'owner 在共享工作區建立篩選器');

select results_eq(
  $$ select name from public.create_project('29000000-0000-0000-0000-000000000013',
       jsonb_build_object('id', '29000000-0000-0000-0000-000000000103', 'name', '可刪專案', 'rank', 'A',
         'workspace_id', '29000000-0000-0000-0000-000000000001')) $$,
  $$ values ('可刪專案'::text) $$,
  'owner 在共享工作區建立專案');
reset role;

-- member 刪標籤：這就是畫面上「我是成員、刪了又跑回來」的那條路徑。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select results_eq(
  $$ select deleted_at is not null, name from public.apply_tag_patch('29000000-0000-0000-0000-000000000021',
       '29000000-0000-0000-0000-000000000101', jsonb_build_object('deleted_at', 1700000000000)) $$,
  $$ values (true, '緊急'::text) $$,
  'member 送 tag.delete 補丁後，deleted_at 有值且 name 不被清空');

select results_eq(
  $$ select deleted_at is not null from public.apply_filter_patch('29000000-0000-0000-0000-000000000022',
       '29000000-0000-0000-0000-000000000102', jsonb_build_object('deleted_at', 1700000000000)) $$,
  $$ values (true) $$,
  'member 送 filter.delete 補丁後，deleted_at 有值');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
select results_eq(
  $$ select deleted_at is not null from public.apply_project_patch('29000000-0000-0000-0000-000000000023',
       '29000000-0000-0000-0000-000000000103', jsonb_build_object('deleted_at', 1700000000000)) $$,
  $$ values (true) $$,
  'owner 送 project.delete 補丁後，deleted_at 有值');

select lives_ok(
  $$ select public.apply_tag_patch('29000000-0000-0000-0000-000000000024',
       '29000000-0000-0000-0000-00000000dead', jsonb_build_object('deleted_at', 1700000000000)) $$,
  '對不存在的標籤再送一次刪除補丁不丟錯（冪等）');
reset role;

select * from finish();
rollback;
