-- 0029：apply_tag_patch／apply_project_patch／apply_filter_patch 要真的
-- 套用 deleted_at。task／comment／section 的補丁函式一開始就有
-- （0006／0011／0018），collections 三張表在 0006／0007 寫的時候只覆蓋
-- name／color／rank／query，刪除 op（payload 只有 { deleted_at }）送到
-- 伺服器只會 bump updated_at，列還是活的。
--
-- 畫面上的後果：成員刪標籤是樂觀更新（先從本機拿掉，3 秒防抖後才打
-- apply_tag_patch），Network 當下看不到請求；RPC「成功」後下一輪 pull
-- 把還活著的遠端列當「遠端獨有」合併回來，標籤就自己跑回來。

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
    deleted_at = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else g.deleted_at end,
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where g.id = p_tag_id
  returning * into v_row;

  if not found then
    -- 刪除補丁對已經不在的列視為成功，跟 0022 的 apply_task_patch 同一種冪等。
    if p_patch ? 'deleted_at' then
      return v_row;
    end if;
    raise exception '標籤 % 不存在或沒有寫入權限', p_tag_id;
  end if;
  return v_row;
end;
$$;

create or replace function public.apply_project_patch(p_op_id uuid, p_project_id uuid, p_patch jsonb)
returns public.projects
language plpgsql
as $$
declare
  v_row public.projects;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.projects where id = p_project_id;
    return v_row;
  end if;

  update public.projects p set
    name       = coalesce(p_patch->>'name', p.name),
    color      = coalesce(p_patch->>'color', p.color),
    rank       = coalesce(p_patch->>'rank', p.rank),
    deleted_at = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else p.deleted_at end,
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where p.id = p_project_id
  returning * into v_row;

  if not found then
    if p_patch ? 'deleted_at' then
      return v_row;
    end if;
    raise exception '專案 % 不存在或沒有寫入權限', p_project_id;
  end if;
  return v_row;
end;
$$;

create or replace function public.apply_filter_patch(p_op_id uuid, p_filter_id uuid, p_patch jsonb)
returns public.filters
language plpgsql
as $$
declare
  v_row public.filters;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.filters where id = p_filter_id;
    return v_row;
  end if;

  update public.filters f set
    name       = coalesce(p_patch->>'name', f.name),
    query      = coalesce(p_patch->>'query', f.query),
    color      = coalesce(p_patch->>'color', f.color),
    rank       = coalesce(p_patch->>'rank', f.rank),
    deleted_at = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else f.deleted_at end,
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where f.id = p_filter_id
  returning * into v_row;

  if not found then
    if p_patch ? 'deleted_at' then
      return v_row;
    end if;
    raise exception '篩選器 % 不存在或沒有寫入權限', p_filter_id;
  end if;
  return v_row;
end;
$$;
