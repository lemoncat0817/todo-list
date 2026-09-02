-- M2：邀請流程的資料層。真正寄信的部分是 Edge Function（呼叫
-- create_invitation() 拿到一次性 token 之後組信件連結寄出，不在這個
-- 檔案的範圍——這裡只顧資料庫這一半：怎麼發、怎麼收、怎麼防止濫用。
--
-- 只存 token 的雜湊，不存明文：跟密碼／session token 同一個道理，
-- 資料庫外洩不該連帶洩漏所有還沒被接受的邀請連結。create_invitation()
-- 把明文 token 當回傳值交給呼叫端（Edge Function 組進信件連結），
-- 資料庫自己永遠只留得住雜湊，之後也查不回明文。

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.member_role not null,
  token_hash text not null unique,
  invited_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index invitations_workspace_idx on public.invitations (workspace_id);
-- accept_invitation() 用雜湊查表，這個索引本來就靠 unique 約束自動有了
-- （unique 隱含一個索引），這裡不用另外建。

alter table public.invitations enable row level security;

-- 跟 can_manage_project() 判斷的角色範圍完全一樣（owner／admin），只是
-- 這裡的動作是「管工作區成員」不是「管專案」，用同一個名字會讓人誤以為
-- 邀請流程掛在某個專案底下——另外取一個名字，內容不重複定義，直接
-- 委派給既有函式。
create or replace function public.can_manage_workspace(p_workspace uuid)
returns boolean
language sql
stable
as $$
  select public.can_manage_project(p_workspace);
$$;

-- 待處理邀請只有管理者看得到（列出「還在等誰接受」用），不是公開資訊。
create policy invitations_select on public.invitations
  for select using (public.can_manage_workspace(workspace_id));
create policy invitations_insert on public.invitations
  for insert with check (public.can_manage_workspace(workspace_id));
create policy invitations_update on public.invitations
  for update using (public.can_manage_workspace(workspace_id))
          with check (public.can_manage_workspace(workspace_id));

-- 產生一次性邀請 token。同一個信箱在同一個工作區重複邀請時，撤換掉前一個
-- 還沒被接受的邀請而不是疊加——不然管理者「重寄一次」會讓好幾個 token
-- 同時有效，使用者不知道該點哪一封信裡的連結，撤銷其中一個時也搞不清楚
-- 撤的是哪次。owner 角色不開放透過邀請直接授予——那是移交工作區所有權，
-- 影響範圍遠大於一般成員管理，這裡刻意不做，需要的話是另一個明確動作。
create or replace function public.create_invitation(p_workspace_id uuid, p_email text, p_role public.member_role)
returns text
language plpgsql
as $$
declare
  v_token text;
begin
  if p_role = 'owner' then
    raise exception '不能透過邀請直接授予 owner';
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

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
as $$
begin
  update public.invitations
     set revoked_at = now()
   where id = p_invitation_id
     and accepted_at is null;

  if not found then
    raise exception '邀請不存在、已經被接受，或沒有撤銷權限';
  end if;
end;
$$;

-- security definer：接受邀請的人這時還不是工作區成員，對 invitations
-- 沒有任何 select 權限（見上面的 invitations_select policy），必須繞過
-- RLS 才查得到自己手上這個 token 對應哪一筆邀請。真正的授權不是繞過
-- RLS 本身給的——是「必須先算出正確的 token_hash 才找得到列」這件事：
-- 猜不出 token 就等於查不到任何一筆，跟 RLS 想擋的「未經授權存取」是
-- 同一個效果，只是換了一種判斷方式。
--
-- 刻意不檢查「這個 email 是不是目前登入帳號的 email」——多數協作工具
-- 的邀請連結本來就是「誰點誰算」，不強制信箱完全吻合（換一個常用信箱
-- 接受邀請是常見情境）；連結本身能不能被找到、還沒過期、還沒被用掉，
-- 才是這裡真正在把關的事。
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
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

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invitation.workspace_id, auth.uid(), v_invitation.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update public.invitations set accepted_at = now() where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;
