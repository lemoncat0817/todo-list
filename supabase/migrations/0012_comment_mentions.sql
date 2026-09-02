-- M3：留言裡的 @提及。
--
-- mentioned_user_ids 由 client 端在送出留言時就解析好（比對
-- workspace.members，跟 TaskComments.vue 顯示作者名稱用的是同一份
-- 名單），資料庫端不重新解析文字——這裡存的是「結果」，不是「規則」，
-- 跟 tasks.tag_ids 是同一個模式：陣列本身沒有 FK 約束，內容的正確性
-- 由 client 端「只能從目前工作區成員裡選」這個 UI 限制保證，資料庫
-- 不需要為了驗證幾個 uuid 是不是真的成員另外寫一支函式。
--
-- 不做「被提及就跳出通知」——那是 M4（推播通知）的範圍，這裡只負責
-- 把「這則留言提到了誰」存成結構化資料，讓 M4 接手時不用重新解析
-- 一次歷史留言。
alter table public.comments add column mentioned_user_ids uuid[] not null default '{}';

create or replace function public.create_comment(p_op_id uuid, p_row jsonb)
returns public.comments
language plpgsql
as $$
declare
  v_row public.comments;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.comments where id = (p_row->>'id')::uuid;
    return v_row;
  end if;

  insert into public.comments (id, task_id, body, mentioned_user_ids, created_at, updated_at)
  values (
    (p_row->>'id')::uuid,
    (p_row->>'task_id')::uuid,
    p_row->>'body',
    case when p_row ? 'mentioned_user_ids'
      then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_row->'mentioned_user_ids') x)
      else '{}' end,
    coalesce((p_row->>'created_at')::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.apply_comment_patch(p_op_id uuid, p_comment_id uuid, p_patch jsonb)
returns public.comments
language plpgsql
as $$
declare
  v_row public.comments;
begin
  insert into public.processed_ops (op_id) values (p_op_id) on conflict do nothing;
  if not found then
    select * into v_row from public.comments where id = p_comment_id;
    return v_row;
  end if;

  update public.comments c set
    body               = coalesce(p_patch->>'body', c.body),
    mentioned_user_ids = case when p_patch ? 'mentioned_user_ids'
      then (select coalesce(array_agg(x::uuid), '{}'::uuid[]) from jsonb_array_elements_text(p_patch->'mentioned_user_ids') x)
      else c.mentioned_user_ids end,
    deleted_at   = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::bigint else c.deleted_at end,
    updated_at   = (extract(epoch from clock_timestamp()) * 1000)::bigint
  where c.id = p_comment_id
  returning * into v_row;

  if not found then
    raise exception '留言 % 不存在或沒有寫入權限', p_comment_id;
  end if;
  return v_row;
end;
$$;
