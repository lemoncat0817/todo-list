-- M2：邀請流程驗證。covers create/revoke/accept 三支 RPC 的權限邊界
-- 與正確性，不含真正寄信（那是 Edge Function 的事，不在資料層範圍）。
begin;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000a11c', 'authenticated', 'authenticated', 'alice@invite-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000b0b0', 'authenticated', 'authenticated', 'bob@invite-test.local', 'x', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ca20', 'authenticated', 'authenticated', 'carol@invite-test.local', 'x', now(), now(), now(), '{}', '{}');

select id as alice_ws from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c' \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';

-- 1) owner 可以建立邀請，拿到一個非空的 token。
do $$
declare v_token text;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'bob@invite-test.local', 'member') into v_token;
  if v_token is null or length(v_token) < 32 then
    raise exception 'token 應該是一段夠長的字串';
  end if;
  perform set_config('test.token', v_token, false);
end $$;
select ok(current_setting('test.token', true) is not null, 'create_invitation 回傳非空 token');

-- 2) 不能邀請成 owner。
select throws_ok(
  format($fmt$ select public.create_invitation(%L, 'x@test.local', 'owner') $fmt$, :'alice_ws'),
  null, null, '不能透過邀請直接授予 owner');

-- 3) 一般成員（非 admin/owner）不能建立邀請。
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.create_invitation(%L, 'x@test.local', 'member') $fmt$, :'alice_ws'),
  null, null, '非成員不能建立邀請');

reset role;

-- 4) Bob 用正確的 token 接受邀請，成為工作區成員。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';

select lives_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.token', true)),
  'accept_invitation 用正確 token 成功');

reset role;

select is(
  (select role::text from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
      and user_id = '00000000-0000-0000-0000-00000000b0b0'),
  'member', 'Bob 真的成為 member');

-- 5) 同一個 token 不能用第二次。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.token', true)),
  null, null, '已經被接受過的 token 不能再用一次');
reset role;

-- 6) 亂猜的 token 直接失敗。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  $$ select public.accept_invitation('this-is-not-a-real-token') $$,
  null, null, '亂猜的 token 找不到對應的邀請');
reset role;

-- 7) 重複邀請同一個信箱：舊的 token 會失效（被撤換），不是疊加成兩個都有效。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
do $$
declare v_first text; v_second text;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'carol@invite-test.local', 'viewer') into v_first;
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'carol@invite-test.local', 'viewer') into v_second;
  perform set_config('test.first_token', v_first, false);
  perform set_config('test.second_token', v_second, false);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ca20","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.first_token', true)),
  null, null, '重新邀請同一個信箱後，第一次的舊 token 已經失效');
select lives_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.second_token', true)),
  '第二次（最新）的 token 仍然有效');
reset role;

-- 8) 過期的邀請不能被接受。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
do $$
declare v_token text;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'expired@invite-test.local', 'viewer') into v_token;
  update public.invitations set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');
  perform set_config('test.expired_token', v_token, false);
end $$;
reset role;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000dddd', 'authenticated', 'authenticated', 'dave@invite-test.local', 'x', now(), now(), now(), '{}', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000dddd","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.expired_token', true)),
  null, null, '過期的邀請不能被接受');
reset role;

-- 9) 撤銷後的邀請不能被接受。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
do $$
declare v_token text; v_id uuid;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'revoked@invite-test.local', 'viewer') into v_token;
  select id into v_id from public.invitations where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');
  perform public.revoke_invitation(v_id);
  perform set_config('test.revoked_token', v_token, false);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000dddd","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.revoked_token', true)),
  null, null, '已撤銷的邀請不能被接受');
reset role;

-- 10) M6 補做：owner 建立一份要給別人的邀請，自己不小心點了那個連結
-- ——不能讓自己被降級（真實案例踩到的 bug，見 0024_prevent_self_demote.sql）。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
do $$
declare v_token text;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'someone-else@invite-test.local', 'member') into v_token;
  perform set_config('test.self_click_token', v_token, false);
end $$;
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.self_click_token', true)),
  null, null, 'owner 自己點了自己發的邀請連結，不會被降級');
select is(
  (select role::text from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
      and user_id = '00000000-0000-0000-0000-00000000a11c'),
  'owner', 'Alice 的角色仍然是 owner，沒有被邀請連結改掉');
reset role;

-- 11) 已經是成員的 Bob，收到（或撿到）一份信箱不是自己的邀請連結
-- ——不能拿別人的邀請連結改自己的角色，反過來也一樣：不能讓 Bob
-- 用這份邀請把自己的角色改成邀請裡指定的那個。
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a11c","role":"authenticated"}';
do $$
declare v_token text;
begin
  select public.create_invitation((select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c'), 'not-bob@invite-test.local', 'admin') into v_token;
  perform set_config('test.mismatched_email_token', v_token, false);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000b0b0","role":"authenticated"}';
select throws_ok(
  format($fmt$ select public.accept_invitation(%L) $fmt$, current_setting('test.mismatched_email_token', true)),
  null, null, '邀請信箱跟目前登入帳號的信箱對不上時拒絕，不會默默換角色');
reset role;

select is(
  (select role::text from public.workspace_members
    where workspace_id = (select id from public.workspaces where created_by = '00000000-0000-0000-0000-00000000a11c')
      and user_id = '00000000-0000-0000-0000-00000000b0b0'),
  'member', 'Bob 的角色維持原本的 member，沒有被那份不是給他的邀請改掉');

select * from finish();
rollback;
