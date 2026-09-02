-- M1：補齊 tags 的補丁函式，跟 projects/tags/filters 的 create_* ——
-- outbox 上傳器要能對四張表都走「同一種 op kind 對一支 RPC」的規則，
-- tags 原本只有 upsert 沒有補丁函式、其餘三張表原本只有補丁沒有建立
-- 專用的 RPC，會讓上傳器需要為 tags 的建立跟其他三張表的建立各寫一支
-- 特殊分支。
--
-- create_* 系列存在的理由跟 create_task 一樣：不是「upsert 不夠用」——
-- upsert 本身對全新 id 就是安全的——而是「重送」的安全性。outbox
-- 送出一筆 create 後，如果因為網路逾時誤以為失敗而重送，這時如果
-- 這筆列已經被其他裝置 patch 過，重送同一份「建立當下的完整快照」
-- 會把那個 patch 蓋掉。op_id 去重讓「已經處理過的重送」直接回傳現在
-- 的列，不會重新套用那份過期的建立快照。

create or replace function public.apply_tag_patch(p_op_id uuid, p_tag_id uuid, p_patch jsonb)
returns public.tags
language plpgsql
as $$
declare
  v_row public.tags;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.tags where id = p_tag_id;
    return v_row;
  end if;

  update public.tags g set
    name       = coalesce(p_patch->>'name', g.name),
    color      = coalesce(p_patch->>'color', g.color),
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where g.id = p_tag_id
  returning * into v_row;

  if not found then
    raise exception '標籤 % 不存在或沒有寫入權限', p_tag_id;
  end if;
  return v_row;
end;
$$;

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

  insert into public.projects (id, name, color, rank, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#1d4ed8'),
    p_row->>'rank',
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

  insert into public.tags (id, name, color, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    coalesce(p_row->>'color', '#15803d'),
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

  insert into public.filters (id, name, query, color, rank, updated_at)
  values (
    (p_row->>'id')::uuid,
    p_row->>'name',
    p_row->>'query',
    coalesce(p_row->>'color', '#7c3aed'),
    p_row->>'rank',
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;
