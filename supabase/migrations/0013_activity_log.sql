-- M3：活動記錄。跟留言不同的地方——留言是使用者說的話，活動記錄是
-- 系統對「這筆任務發生過什麼」的客觀陳述，兩者的可信度要求不一樣，
-- 所以活動記錄完全不開放使用者直接寫入，只由 trigger 產生。
--
-- trigger 產生（而不是 client 端算好 diff 再送一個 create_activity
-- RPC）是刻意的：活動記錄的價值在於「不管是哪個 client、哪個版本、
-- 甚至是有 bug 的 client 寫的，任務真的變成什麼樣子都會留下紀錄」——
-- 這正是資料庫層級才保證得了的事，client 端算 diff 只能保證「這個
-- client 這次記得算」。代價是隻能記錄資料庫看得到的欄位變化，
-- 不像留言可以帶使用者自己的文字說明。
--
-- 只記幾個真的算「事件」的欄位變化（建立、完成／取消完成、換專案），
-- 不是每個欄位變動都留一筆——notes 每打一個字都在變、rank 拖曳排序時
-- 常常變，這些是「編輯」不是「事件」，全部記下來只會讓活動記錄本身
-- 比留言還吵，需要更多欄位時再擴充 kind 的種類。
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  -- 刻意可為 null，不是 not null：任務不是永遠透過一個帶 JWT 的請求
  -- 寫入的（測試腳本、遷移、未來可能的伺服器端批次匯入都會直接以
  -- superuser 身分寫 tasks 表），這些情境下 auth.uid() 就是 null——
  -- 「不知道是誰做的」該誠實記成 null，不該硬套一個約束逼出一個假的
  -- 使用者，也不該讓這種寫入直接整個失敗。
  actor_id uuid default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}',
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  -- 活動記錄不可變，updated_at 理論上永遠等於 created_at——但同步輪詢
  -- 拉取（sync/restClient.ts 的 fetchRowsSince）統一走 `updated_at > 游標`
  -- 這個查詢形狀，四張既有表都有這個欄位，這裡沒有的話就得為了這一張表
  -- 另外做一套查詢邏輯。與其讓通用同步機制多分兩支，不如讓這張表也照
  -- 這個慣例存一份（值恆等於 created_at），換一個欄位的重複，省一條
  -- 特例路徑。
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

create index activity_log_task_idx on public.activity_log (task_id);

alter table public.activity_log enable row level security;

-- select 用 project_role()（跟 tasks_select 同一顆），不是 can_comment()：
-- 活動記錄是事實陳述，看得到任務的人（含 viewer）就該看得到，不用
-- 拉高到「能留言」那一層。
create policy activity_log_select on public.activity_log
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.project_role(t.project_id) is not null)
  );

-- 刻意不建 insert／update／delete policy 給一般使用者：唯一的寫入路徑
-- 是下面的 security definer trigger，任何人都不能直接插入、竄改或
-- 刪除一筆活動記錄——包括自己那筆。

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 同一次觸發要是真的記多筆（例如一次補丁同時完成任務又換專案），
  -- created_at／updated_at 要一致，不要各自呼叫 clock_timestamp() 讓
  -- 同一個事件切面下的幾筆活動記錄時間戳還些微不同。
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

  return new;
end;
$$;

create trigger tasks_log_activity
  after insert or update on public.tasks
  for each row execute function public.log_task_activity();
