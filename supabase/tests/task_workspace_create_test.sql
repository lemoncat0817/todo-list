-- 受邀成員在別人的工作區新增未分類任務，必須落到該工作區的收件匣，
-- 不是建立者自己的個人工作區（見 0026）。
begin;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@ws-create-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@ws-create-test.local', 'x', now(), now(), now(), '{}', '{}');

-- Bob 是 Alice 工作區的共編成員（不是 viewer）。
insert into public.workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000b0b0', 'member'
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c';

select id as alice_ws
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c' \gset
select id as alice_inbox
  from public.projects
 where workspace_id = :'alice_ws'::uuid and is_inbox \gset
select id as bob_ws
  from public.workspaces where created_by = '00000000-0000-0000-0000-00000000b0b0' \gset
select id as bob_inbox
  from public.projects
 where workspace_id = :'bob_ws'::uuid and is_inbox \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

-- 1) Bob 帶 Alice 的 workspace_id、不帶 project_id → 落在 Alice 的收件匣。
select format($fmt$ select workspace_id, project_id from public.create_task(
  '26000000-0000-0000-0000-000000000001',
  jsonb_build_object('id', '26000000-0000-0000-0000-000000000011', 'task_name', '寫在 A 的工作區',
    'rank', 'A', 'workspace_id', %L)
) $fmt$, :'alice_ws') as bob_in_alice_sql \gset

select results_eq(
  :'bob_in_alice_sql',
  format($fmt$ values (%L::uuid, %L::uuid) $fmt$, :'alice_ws', :'alice_inbox'),
  '受邀成員帶 workspace_id 新增，落到該工作區收件匣而不是自己的個人工作區');

-- 2) Bob 什麼都不帶 → 維持舊行為，落到自己的個人收件匣。
select results_eq(
  $$ select workspace_id, project_id from public.create_task(
       '26000000-0000-0000-0000-000000000002',
       jsonb_build_object('id', '26000000-0000-0000-0000-000000000012', 'task_name', '寫在自己的',
         'rank', 'B')
     ) $$,
  format($fmt$ values (%L::uuid, %L::uuid) $fmt$, :'bob_ws', :'bob_inbox'),
  '不帶 workspace_id／project_id 時仍落到建立者的個人收件匣');

reset role;

-- 3) 非成員帶別人的 workspace_id 必須被拒，不能默默改寫進自己的空間。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

-- 先把 Bob 移出 Alice 的工作區再試一次。用 table owner 身分改成員表。
reset role;
delete from public.workspace_members
 where workspace_id = :'alice_ws'::uuid and user_id = '00000000-0000-0000-0000-00000000b0b0';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

select format($fmt$ select public.create_task(
  '26000000-0000-0000-0000-000000000003',
  jsonb_build_object('id', '26000000-0000-0000-0000-000000000013', 'task_name', '不該成功',
    'rank', 'C', 'workspace_id', %L)
) $fmt$, :'alice_ws') as bob_forbidden_sql \gset

select throws_ok(:'bob_forbidden_sql', 'TK003', '沒有權限在這個工作區新增任務',
  '不是成員時帶別人的 workspace_id 被拒');

-- 4) 帶了不屬於自己的 workspace_id 被拒之後，不該留下一筆落到個人工作區的任務。
select is(
  (select count(*)::int from public.tasks where id = '26000000-0000-0000-0000-000000000013'),
  0,
  '權限被拒時不會另外寫出一筆落到個人工作區的任務');

reset role;

select * from finish();
rollback;
