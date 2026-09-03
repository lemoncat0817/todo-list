-- 0022：修正 PostgREST 的 PTxyz 錯誤碼衝突與 task.delete 冪等性
--
-- 1) PostgREST 內部保留以 'PT' 開頭的 5 碼 SQLSTATE（PTxyz），並將後三碼解析為 HTTP 狀態碼
--    傳回給客戶端（例如 PT404 -> HTTP 404）。
--    先前 0020 與 0021 使用的 PT001、PT002、PT003、PT004 導致 PostgREST 嘗試傳回 HTTP 001~004
--    等非法狀態碼，在 Supabase Envoy 網關處直接被以「protocol error」中斷連線並拋出 HTTP 502。
--    這裡改為 TK001、TK002、TK003、WS004，避免觸發 PostgREST 的 PTxyz 特殊攔截，正常傳回 HTTP 400 與錯誤物件。
--
-- 2) apply_task_patch() 對於帶有 deleted_at 的刪除補丁（task.delete）：
--    若任務在資料庫中本來就不存在，代表刪除目的已經達成，直接返回，不再拋出異常。

create or replace function public.apply_task_patch(p_op_id uuid, p_task_id uuid, p_patch jsonb)
returns public.tasks
language plpgsql
as $$
declare
  v_row public.tasks;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_reason text;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tasks where id = p_task_id;
    return v_row;
  end if;

  update public.tasks t set
    task_name    = coalesce(p_patch->>'task_name', t.task_name),
    is_completed = coalesce((p_patch->>'is_completed')::boolean, t.is_completed),
    rank         = coalesce(p_patch->>'rank', t.rank),
    notes        = coalesce(p_patch->>'notes', t.notes),
    priority     = coalesce((p_patch->>'priority')::smallint, t.priority),
    due_date     = case when p_patch ? 'due_date' then p_patch->>'due_date' else t.due_date end,
    due_time     = case when p_patch ? 'due_time' then p_patch->>'due_time' else t.due_time end,
    project_id   = coalesce((p_patch->>'project_id')::uuid, t.project_id),
    tag_ids      = case when p_patch ? 'tag_ids'
                        then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_patch->'tag_ids') x)
                        else t.tag_ids end,
    parent_id    = case when p_patch ? 'parent_id' then (p_patch->>'parent_id')::uuid else t.parent_id end,
    recurrence   = case when p_patch ? 'recurrence' then p_patch->'recurrence' else t.recurrence end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::bigint else t.completed_at end,
    assignee_id  = case when p_patch ? 'assignee_id' then (p_patch->>'assignee_id')::uuid else t.assignee_id end,
    section_id   = case when p_patch ? 'section_id' then (p_patch->>'section_id')::uuid else t.section_id end,
    deleted_at   = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else t.deleted_at end,
    updated_at   = v_now
  where t.id = p_task_id
    and (t.deleted_at is null or p_patch ? 'deleted_at')
  returning * into v_row;

  if not found then
    -- 若為刪除補丁，任務不存在代表已被刪除或本來就沒有，屬冪等操作，直接回傳
    if p_patch ? 'deleted_at' then
      return v_row;
    end if;

    v_reason := public.classify_task_patch_failure(p_task_id);
    if v_reason = 'deleted' then
      raise exception '任務已經被其他成員刪除' using errcode = 'TK001';
    elsif v_reason = 'forbidden' then
      raise exception '沒有權限編輯這筆任務' using errcode = 'TK003';
    else
      raise exception '任務 % 不存在或沒有寫入權限', p_task_id using errcode = 'TK002';
    end if;
  end if;
  return v_row;
end;
$$;

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
    raise exception '這個工作區的成員已滿（上限 % 人）', v_member_cap using errcode = 'WS004';
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
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
     and accepted_at is null;

  if not found then
    raise exception '無效或已過期的邀請連結';
  end if;

  select count(*) into v_member_count
    from public.workspace_members
   where workspace_id = v_invitation.workspace_id;

  if v_member_count >= v_member_cap then
    raise exception '這個工作區的成員已滿（上限 % 人），請聯絡工作區管理者', v_member_cap using errcode = 'WS004';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invitation.workspace_id, v_user_id, v_invitation.role)
  on conflict (workspace_id, user_id)
  do update set role = excluded.role;

  update public.invitations
     set accepted_at = now()
   where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;

-- 3) 補齊外鍵級聯刪除（ON DELETE CASCADE）：
--    先前的 workspaces.created_by、processed_ops.actor_id、invitations.invited_by
--    缺少 ON DELETE CASCADE，導致在後台刪除 auth.users 時噴出外鍵約束衝突錯誤（Database error deleting user）。
alter table public.workspaces 
  drop constraint if exists workspaces_created_by_fkey,
  add constraint workspaces_created_by_fkey foreign key (created_by) references auth.users(id) on delete cascade;

alter table public.processed_ops 
  drop constraint if exists processed_ops_actor_id_fkey,
  add constraint processed_ops_actor_id_fkey foreign key (actor_id) references auth.users(id) on delete cascade;

alter table public.invitations 
  drop constraint if exists invitations_invited_by_fkey,
  add constraint invitations_invited_by_fkey foreign key (invited_by) references auth.users(id) on delete cascade;

alter table public.invitations 
  drop constraint if exists invitations_invited_by_profile_fkey,
  add constraint invitations_invited_by_profile_fkey foreign key (invited_by) references public.profiles(id) on delete cascade;

-- 4) 修正收件匣專案保護觸發器（projects_protect_inbox）：
--    原本的 reject_inbox_delete() 無條件拋出例外阻擋刪除，導致刪除使用者／工作區時
--    級聯刪除 projects 會被硬性中斷。這裡放寬管理員角色（postgres、supabase_admin、service_role）
--    以及所屬工作區已不存在時的刪除。
create or replace function public.reject_inbox_delete()
returns trigger language plpgsql as $$
begin
  if old.is_inbox then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return old;
    end if;
    if not exists (select 1 from public.workspaces where id = old.workspace_id) then
      return old;
    end if;
    raise exception '收件匣專案不能被刪除';
  end if;
  return old;
end;
$$;


