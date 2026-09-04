-- M3 補齊：活動記錄原本只記建立／完成／重開／換專案（見 0013）。
-- 產品要把「改名稱」「改期」也當成事件——這兩種是協作時別人真的會問
-- 「誰改的、改成什麼」的變動，跟 notes 每打一字、rank 拖曳排序那種
-- 「編輯」噪音不一樣。其餘欄位仍不記。
--
-- 只 replace function，不重建 trigger：tasks_log_activity 已經掛在
-- after insert or update on public.tasks，函式同名替換後下次觸發就走
-- 新邏輯，不需要 drop／create trigger。
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'created', '{}'::jsonb, v_now, v_now);
    return new;
  end if;

  if new.is_completed and not old.is_completed then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'completed', '{}'::jsonb, v_now, v_now);
  elsif old.is_completed and not new.is_completed then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'reopened', '{}'::jsonb, v_now, v_now);
  end if;

  if new.project_id is distinct from old.project_id then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'moved', jsonb_build_object('from', old.project_id, 'to', new.project_id), v_now, v_now);
  end if;

  if new.task_name is distinct from old.task_name then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'renamed', jsonb_build_object('from', old.task_name, 'to', new.task_name), v_now, v_now);
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.activity_log (task_id, kind, detail, created_at, updated_at)
    values (new.id, 'due_changed', jsonb_build_object('from', old.due_date, 'to', new.due_date), v_now, v_now);
  end if;

  return new;
end;
$$;
