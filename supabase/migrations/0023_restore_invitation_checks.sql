-- 0023：修回 0022 重寫 accept_invitation() 時漏掉的幾個檢查。
--
-- 0022 為了修 PT004 → WS004 那個 SQLSTATE 保留字衝突，把整支
-- accept_invitation() 重寫了一次，重寫的過程中不小心把原本 0008／0021
-- 就有的三件事弄丟了，用本機 pgTAP（invitations_test.sql／
-- workspace_member_cap_test.sql）跑出來才抓到，不是憑肉眼比對發現的：
--
-- 1) 邀請過期檢查（expires_at < now()）整個不見了——現在的寫法直接把
--    revoked_at is null and accepted_at is null 塞進 SELECT 的 WHERE
--    子句，`expires_at` 從沒被比對過，等於邀請連結永遠不會過期。
-- 2) 「找不到」「已撤銷」「已使用過」「已過期」四種原本各自有一句話的
--    情況，被前一點的 WHERE 子句合併成同一句「無效或已過期的邀請連結」
--    ——功能上還是會擋下，只是使用者看到的訊息變得籠統。這裡順便修回
--    四種各自的訊息，理由跟計畫書要求的錯誤翻譯層是同一個精神：籠統的
--    說法會讓人以為自己隨便都能重試成功。
-- 3) 「已經是這個工作區成員的人重新接受邀請（換角色）不算新增名額」的
--    豁免判斷不見了——重寫後不管呼叫者是不是已經是成員，只要工作區滿
--    就一律擋下，導致工作區滿了之後連換角色都做不到。
--
-- 三件事都在同一支函式裡，改一次 create or replace 解決，不需要動
-- create_invitation()（那支這次重寫沒有弄丟東西）。

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.invitations;
  v_user_id uuid := (select auth.uid());
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

  -- 只在「這個人還不是成員」時才計入人數上限——已經是成員的人重新
  -- 點同一個連結（下面的 on conflict do update，換角色用）不算新增
  -- 一個名額，工作區滿了也不該擋下這個動作。
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = v_invitation.workspace_id and user_id = v_user_id
  ) then
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
