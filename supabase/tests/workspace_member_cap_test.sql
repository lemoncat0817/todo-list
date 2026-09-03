-- M6 補做：工作區成員數上限（計畫書第 13 節：錯誤翻譯層要能顯示
-- 「工作區成員已滿」）。見 0021_workspace_member_cap.sql 開頭的說明：
-- create_invitation()／accept_invitation() 兩處都要擋，不能只靠其中
-- 一關，也不能誤擋「已經是成員的人重新接受邀請只是換角色」這種情況。
begin;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@cap-test.local', 'x', now(), now(), now(), '{}', '{}');

-- 灌到剛好滿員（20 人，含 Alice 自己這個 owner）：先建立 19 個使用者，
-- 直接以預設角色（可以繞過 RLS 的連線身分）寫進 workspace_members，
-- 不透過 accept_invitation——這支測試要驗證的是「滿了之後」的邊界，
-- 不是灌測試資料的過程本身。
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000',
       ('00000000-0000-0000-0000-0000' || lpad(to_hex(n), 8, '0'))::uuid,
       'authenticated', 'authenticated',
       'member' || n || '@cap-test.local', 'x', now(), now(), now(), '{}', '{}'
  from generate_series(1, 19) as n;

insert into public.workspace_members (workspace_id, user_id, role)
select (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'),
       ('00000000-0000-0000-0000-0000' || lpad(to_hex(n), 8, '0'))::uuid,
       'member'
  from generate_series(1, 19) as n;

select is(
  (select count(*)::int from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')),
  20, '灌完之後工作區剛好 20 個成員（含 Alice）');

-- 1) 滿員時，owner 建立邀請直接被擋下，回報 WS004。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
-- throws_ok 3 個參數的形式比對的是「錯誤訊息」不是 SQLSTATE（pgTAP 沒有
-- (sql, errcode, description) 這個多載，見 rpc_patch_test.sql 同一處的
-- 註解）——要驗證 errcode 必須用 4 個參數的完整形式。
select throws_ok(
  format($fmt$ select public.create_invitation(%L, 'overflow@cap-test.local', 'member') $fmt$,
    (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')),
  'WS004', '這個工作區的成員已滿（上限 20 人）', '工作區成員已滿時，create_invitation 回報 WS004');
reset role;

-- 2) 就算繞過 create_invitation（直接插入一筆有效邀請）拿到 token，
-- accept_invitation 自己也要擋——雙重防線，不能只靠發邀請那一關擋住。
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000d1e1', 'authenticated', 'authenticated', 'newcomer@cap-test.local', 'x', now(), now(), now(), '{}', '{}');

do $$
declare v_token text := 'cap-test-bypass-token-000000000000000000000000';
begin
  insert into public.invitations (workspace_id, email, role, token_hash)
  values ((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'),
          'newcomer@cap-test.local', 'member', encode(extensions.digest(v_token, 'sha256'), 'hex'));
  perform set_config('test.bypass_token', v_token, false);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d1e1","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.bypass_token', true)),
  'WS004', '這個工作區的成員已滿（上限 20 人），請聯絡工作區管理者',
  '工作區成員已滿時，accept_invitation 自己也擋下（不只靠 create_invitation 那一關）');
reset role;

select is(
  (select count(*)::int from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')),
  20, '被擋下的邀請沒有讓成員數超過上限');

-- 3) 已經是成員的人重新點邀請連結（角色被改邀成別的身分）不該被「滿了」
-- 擋下——那不是在新增一個名額，是既有名額換角色（見
-- 0021_workspace_member_cap.sql 的 not exists 判斷）。
do $$
declare v_token text := 'cap-test-existing-member-token-0000000000000000';
begin
  insert into public.invitations (workspace_id, email, role, token_hash)
  values ((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'),
          'member1@cap-test.local', 'admin', encode(extensions.digest(v_token, 'sha256'), 'hex'));
  perform set_config('test.existing_member_token', v_token, false);
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.existing_member_token', true)),
  '已經是成員的人重新接受邀請不受滿員限制（只是換角色）');
reset role;

select is(
  (select role::text from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
      and user_id = '00000000-0000-0000-0000-000000000001'),
  'admin', '角色真的被更新成新邀請指定的身分，不是被擋下');

select * from finish();
rollback;
