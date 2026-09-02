-- M2：create_project／create_tag／create_filter 補上 workspace_id。
--
-- 0004 的 derive_workspace_id() trigger 從一開始就是照著「client 沒送
-- 這個欄位才補上個人工作區」設計的（見該檔案的註解：「在共享工作區底下
-- 新建專案就是靠明確帶 workspace_id 做到」），但 0007 加這三支 create_*
-- RPC 時，INSERT 的欄位清單裡漏了 workspace_id——不管 client 的 outbox
-- 送出的 payload 裡有沒有這個鍵，trigger 看到的 NEW.workspace_id 永遠是
-- NULL，於是永遠落回呼叫者的個人工作區。結果是：使用者被邀請加入共享
-- 工作區、也看得到裡面既有的專案，卻無法透過這條路徑在那個工作區底下
-- 建立任何新專案／標籤／篩選器——不是權限被擋，是這個欄位根本沒被送
-- 進 INSERT 陳述式。
--
-- 這裡不需要額外的授權檢查：三支函式都不是 security definer（沿用
-- create_task 同一套，security invoker），0005_rls.sql 的
-- projects_insert／tags_insert／filters_insert policy 本來就用
-- WITH CHECK (can_manage_project(workspace_id)／can_write_task(...))
-- 擋著——client 塞一個自己管不到的 workspace_id，INSERT 本身就會被
-- RLS 拒絕並丟例外，不會因為多接了這個欄位而多出一個漏洞。
--
-- p_row 沒帶 workspace_id 時 (p_row->>'workspace_id')::uuid 是 NULL，
-- INSERT 進去的 NEW.workspace_id 一樣是 NULL，trigger 照舊補上個人
-- 工作區——既有「不指定就落個人工作區」的行為完全不變。

create or replace function public.create_project(p_op_id uuid, p_row jsonb)
returns public.projects
language plpgsql
as $$
declare
  v_row public.projects;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.projects where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.projects (id, name, color, rank, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#1d4ed8'),
    p_row->>'rank',
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_tag(p_op_id uuid, p_row jsonb)
returns public.tags
language plpgsql
as $$
declare
  v_row public.tags;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tags where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.tags (id, name, color, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#15803d'),
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_filter(p_op_id uuid, p_row jsonb)
returns public.filters
language plpgsql
as $$
declare
  v_row public.filters;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.filters where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.filters (id, name, query, color, rank, workspace_id, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    p_row->>'query',
    coalesce(p_row->>'color', '#7c3aed'),
    p_row->>'rank',
    (p_row->>'workspace_id')::uuid,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;
