-- create_* 對「不同 op_id、同一個目標 id」也必須冪等（見 0028）。
begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@create-idem.local', 'x', now(), now(), now(), '{}', '{}');

select id as alice_inbox
  from public.projects
 where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
   and is_inbox \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

select format($fmt$ select public.create_task(
  '28000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', '28000000-0000-0000-0000-000000000011', 'task_name', '原始名稱',
    'rank', 'A', 'project_id', %L)
) $fmt$, :'alice_inbox') as first_create \gset
select lives_ok(:'first_create', '第一次 create_task 成功');

-- 不同 op_id、同一個 task id、payload 還帶了別的名稱——必須活下來，且
-- 不能把既有列蓋成「應該被忽略」。
select format($fmt$ select task_name from public.create_task(
  '28000000-0000-0000-0000-000000000002',
  jsonb_build_object('id', '28000000-0000-0000-0000-000000000011', 'task_name', '應該被忽略',
    'rank', 'Z', 'project_id', %L)
) $fmt$, :'alice_inbox') as second_create \gset

select results_eq(
  :'second_create',
  $$ values ('原始名稱'::text) $$,
  '不同 op_id 再 create 同一 id 時回傳既有列，不覆蓋 task_name');

select is(
  (select count(*)::int from public.tasks where id = '28000000-0000-0000-0000-000000000011'),
  1,
  '同一個 task id 不會因為第二次 create 多出一列');

select is(
  (select count(*)::int from public.processed_ops
    where op_id in (
      '28000000-0000-0000-0000-000000000001',
      '28000000-0000-0000-0000-000000000002')),
  2,
  '兩次 create 的 op_id 都記進 processed_ops');

reset role;

select * from finish();
rollback;
