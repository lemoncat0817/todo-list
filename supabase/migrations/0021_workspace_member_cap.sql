-- M6 補做：計畫書第 13 節列的四種新失敗類型，最後一種跟任務無關——
-- 「工作區成員已滿」。在這之前工作區沒有任何成員數上限，這裡補上一個
-- 固定門檻，讓這個錯誤真的有機會發生、也有明確的訊息可以顯示，而不是
-- 一個永遠不會走到的分支。
--
-- 20 人是這個工具的量級（個人／小團隊協作，不是企業版）下足夠寬裕的
-- 起始值，不是跟計費綁定的方案上限——這個 repo 沒有付費分級，純粹是
-- 擋住異常成長（例如邀請流程被誤用／濫用）的軟性防線，跟 0019 附件
-- 500MB 配額同一個性質，之後要調整只需要改這兩個函式裡的常數。
--
-- 只需要在「真的會新增一筆 workspace_members」的地方檢查：
--   1) accept_invitation()——唯一的成員新增入口。
--   2) create_invitation()——雖然發邀請本身不會馬上讓人數變多，但先在
--      這裡也擋一次，讓管理者在按下「邀請」的當下就得到「已滿」的
--      回饋，不必等對方點連結才發現邀請其實接受不了。
-- updateMemberRole()／removeMember() 都不會新增成員（前者是既有列的
-- UPDATE，後者是 DELETE），不需要改。

create or replace function public.create_invitation(p_workspace_id uuid, p_email text, p_role public.member_role)
returns text
language plpgsql
as $$
declare
  v_token text;
  v_member_cap constant int := 20;
  v_member_count int;
begin
  if p_role = 'owner' then
    raise exception '不能透過邀請直接授予 owner';
  end if;

  select count(*) into v_member_count
    from public.workspace_members
   where workspace_id = p_workspace_id;

  if v_member_count >= v_member_cap then
    raise exception '這個工作區的成員已滿（上限 % 人）', v_member_cap using errcode = 'PT004';
  end if;

  update public.invitations
     set revoked_at = now()
   where workspace_id = p_workspace_id
     and lower(email) = lower(p_email)
     and accepted_at is null
     and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invitations (workspace_id, email, role, token_hash)
  values (p_workspace_id, p_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'));

  return v_token;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
  v_member_cap constant int := 20;
  v_member_count int;
begin
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

  -- 只在「這個人還不是成員」時才計入人數上限——已經是成員的人重新
  -- 點同一個連結（下面的 on conflict do update，常見於角色被重新
  -- 邀請成不同身分）不該因為工作區剛好滿了就被擋下，那不是在新增
  -- 一個成員名額。
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = v_invitation.workspace_id and user_id = auth.uid()
  ) then
    select count(*) into v_member_count
      from public.workspace_members
     where workspace_id = v_invitation.workspace_id;

    if v_member_count >= v_member_cap then
      raise exception '這個工作區的成員已滿（上限 % 人），請聯絡工作區管理者', v_member_cap using errcode = 'PT004';
    end if;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invitation.workspace_id, auth.uid(), v_invitation.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;
