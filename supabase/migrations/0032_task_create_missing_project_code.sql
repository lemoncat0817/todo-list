-- 0032：derive_task_workspace() 在 project_id 指到一個不存在的專案時，
-- 原本用預設的 P0001（RAISE EXCEPTION 沒指定 errcode 就是這個），前端
-- 沒辦法把它跟其他「暫時性、值得重試」的失敗分開——outbox 只能照一般
-- 網路錯誤處理，盲目重試到 MAX_OP_ATTEMPTS 才捨棄（stores/sync.ts 的
-- drainOutbox()），捨棄後這筆任務就永久停在「本機有、伺服器沒有」。
--
-- 常見成因：本機建立一個任務、指到某個專案，該任務的 task.create 都還
-- 沒送到伺服器，使用者就把那個專案刪了——專案的 create 這時多半也
-- 還沒送達，於是任務引用的專案永遠不會出現在伺服器上。
--
-- 跟 0022 把 apply_task_patch() 的失敗原因分類成 TK001/TK002/TK003
-- 是同一個處理方式：補一個自訂 SQLSTATE，讓 client 端能精準辨認並自己
-- 復原（見 stores/sync.ts 的 invalidateFingerprint() 與 drainOutbox()
-- 內對 TK004 的處理——清掉本地指紋讓下一輪用當下最新的任務內容重新
-- 判斷該送 create 還是 patch，通常這時任務的 project_id 在本機早就被
-- 使用者刪除專案時清成 null 了，重新送出就不會再撞同一面牆）。
--
-- 沿用 TK 前綴而不是 PT：0022 發現 PostgREST 會特殊攔截 PTxyz 這個
-- SQLSTATE class，把 xyz 誤當成 HTTP 狀態碼處理，導致回應失真。
create or replace function public.derive_task_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_actor uuid := coalesce(new.user_id, (select auth.uid()));
begin
  if new.project_id is not null then
    select workspace_id into v_workspace from public.projects where id = new.project_id;
    if v_workspace is null then
      raise exception 'project % 不存在或尚未歸屬工作區', new.project_id using errcode = 'TK004';
    end if;
    new.workspace_id := v_workspace;
  else
    if new.workspace_id is not null then
      if not exists (
        select 1 from public.workspace_members wm
         where wm.workspace_id = new.workspace_id and wm.user_id = v_actor
      ) then
        raise exception '沒有權限在這個工作區新增任務' using errcode = 'TK003';
      end if;
      v_workspace := new.workspace_id;
    else
      v_workspace := public.personal_workspace_id(v_actor);
    end if;
    new.workspace_id := v_workspace;
    select id into new.project_id from public.projects where workspace_id = v_workspace and is_inbox;
  end if;
  return new;
end;
$$;
