-- 0024：防止透過接受邀請把自己（尤其是工作區擁有者）意外降級。
--
-- 真實案例：使用者以 owner 身分建立一份要給別人的邀請，自己不小心
-- 點了那個連結，accept_invitation() 既有的「已經是成員 → 直接換角色」
-- 設計（見 0021／0023）完全沒檢查「點連結的人是不是邀請信真正指定
-- 的那個人」，結果是 owner 自己的角色被邀請裡指定的角色（例如
-- member）覆蓋掉，工作區瞬間變成沒有任何 owner。
--
-- 「已經是成員時可以直接換角色」這個設計本身是合理的（正常情境：
-- 管理者想把某人從 viewer 升成 admin，重新發一次邀請，對方點了就
-- 生效），問題出在「誰點都算」——0008_invitations.sql 當初的說明
-- 「刻意不檢查信箱」是為了支援「新加入者用不同慣用信箱接受邀請」
-- 這個情境，但同一套邏輯套用到「已經是成員」的情況，就變成任何人
-- （包含邀請人自己、或工作區裡其他任何成員）只要拿到連結，都能把
-- 「連結真正指定的那個人」的角色改到自己頭上。
--
-- 修法分兩層，只影響「已經是成員」這個分支，全新加入者（0008 原本
-- 的「誰點誰算」）完全不受影響：
-- 1) 一般規則：已經是成員時，只有「邀請信指定的信箱＝目前登入帳號的
--    信箱」才允許直接換角色；信箱對不上就明確拒絕，不再默默生效。
-- 2) 額外防線（不依賴信箱比對是否正確，直接擋最壞情況）：工作區目前
--    的 owner 角色一律不能透過這個路徑被改動——owner 授予本來就刻意
--    不開放透過邀請完成（見 create_invitation 的「不能透過邀請直接
--    授予 owner」），沒理由讓它能反過來被邀請「收回」。

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.invitations;
  v_user_id uuid := (select auth.uid());
  v_user_email text;
  v_existing_role public.member_role;
  v_member_cap constant int := 20;
  v_member_count int;
begin
  if v_user_id is null then
    raise exception '必須登入才能接受邀請';
  end if;

  select * into v_invitation
    from public.invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not found then
    raise exception '邀請連結無效';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception '這個邀請已經被撤銷';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception '這個邀請已經被使用過';
  end if;
  if v_invitation.expires_at < now() then
    raise exception '這個邀請已經過期';
  end if;

  select role into v_existing_role
    from public.workspace_members
   where workspace_id = v_invitation.workspace_id and user_id = v_user_id;

  if found then
    -- 已經是這個工作區的成員：這條路徑是給「管理者重新邀請、換角色」
    -- 用的，只有邀請信指定的信箱跟目前登入帳號一致才放行。
    if v_existing_role = 'owner' then
      raise exception '你是這個工作區的擁有者，不能透過邀請連結變更自己的身分';
    end if;

    select email into v_user_email from auth.users where id = v_user_id;
    if v_user_email is null or lower(v_user_email) <> lower(v_invitation.email) then
      raise exception '這個邀請不是寄給你的信箱，無法用來變更你的身分';
    end if;
  else
    -- 還不是成員：維持既有的「誰點誰算」（見 0008_invitations.sql
    -- 的說明），不檢查信箱是否吻合。人數上限只在這個分支計算——
    -- 已經是成員的人換角色不算新增名額（見 0021／0023）。
    select count(*) into v_member_count
      from public.workspace_members
     where workspace_id = v_invitation.workspace_id;

    if v_member_count >= v_member_cap then
      raise exception '這個工作區的成員已滿（上限 % 人），請聯絡工作區管理者', v_member_cap using errcode = 'WS004';
    end if;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invitation.workspace_id, v_user_id, v_invitation.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;

-- 一次性回填：修回已經被這個 bug 影響、被降級的工作區建立者。
-- 「工作區建立者永遠是自己那個工作區的 owner」這個不變量從建立當下
-- 就該成立（見 workspaces 表的建立流程），目前也沒有任何功能允許
-- 刻意移交所有權（MembersDialog.vue 明確寫著這是刻意不做的範圍界定）
-- ——換句話說 created_by 的人如果不是 owner，唯一的原因就是上面這個
-- bug，這裡把它修回去，不影響任何原本就正確的列。
update public.workspace_members wm
   set role = 'owner'
  from public.workspaces w
 where w.id = wm.workspace_id
   and w.created_by = wm.user_id
   and wm.role <> 'owner';
