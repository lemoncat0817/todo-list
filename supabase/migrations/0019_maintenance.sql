-- M6：韌性與規模——墓碑與操作記錄清理、速率限制、儲存配額、可查詢的
-- 觀測指標。計畫書把這個里程碑標成「持續」（不是固定週數），這裡做的
-- 是三件有明確驗收標準、能在這個資料庫裡實際落地的事；Realtime 同時
-- 連線數、Sentry 回報、Postgres 日誌這幾項本來就是外部儀表板/服務的
-- 事，不是這個 repo 能生出程式碼的範圍，誠實地不假裝有做。

-- ---------------------------------------------------------- device_cursors

-- 墓碑清除的前提是「所有裝置都同步過這個時間點之後」——純 REST 輪詢
-- 沒有天生的刪除事件（見 0001/0002 的墓碑機制本身），太早刪掉墓碑會讓
-- 還沒同步到那個時間點的裝置永遠不知道那筆資料已經被刪除、把它當成
-- 「一直都在、只是還沒同步過來」。這張表讓每台裝置回報「我同步到哪裡
-- 了」，清理工作才有依據。
--
-- 沒有 workspace_id：故意做成全域的裝置游標，不是逐工作區各自一份。
-- 墓碑列本身仍保留原本的 project_id／workspace_id（軟刪除只標記
-- deleted_at，不清空其他欄位），理論上可以只等「看得到這筆資料的
-- 工作區」成員的裝置同步過即可，但那需要對每張表個別反查工作區成員、
-- 複雜度換不到實際好處——這個工具的量級，用全域裝置游標保守但正確：
-- 任何一台裝置只要還沒同步到那個時間點，墓碑就不會被清掉，唯一的
-- 代價是「一台長期沒開的裝置」會拖住清理，但正確性優先於清理及時性。
create table public.device_cursors (
  device_id uuid primary key,
  -- default auth.uid()，不是給 client 送什麼就存什麼——跟 tasks/projects
  -- 等表的 user_id 同一個理由（見 0001 的說明）：這筆屬於誰完全由請求
  -- 帶的 JWT 決定，client 端沒有欄位可以造假。
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  last_synced_at bigint not null,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

create index device_cursors_user_idx on public.device_cursors (user_id);

alter table public.device_cursors enable row level security;
create policy device_cursors_select on public.device_cursors
  for select using (user_id = (select auth.uid()));
create policy device_cursors_insert on public.device_cursors
  for insert with check (user_id = (select auth.uid()));
create policy device_cursors_update on public.device_cursors
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy device_cursors_delete on public.device_cursors
  for delete using (user_id = (select auth.uid()));

-- 沒有任何裝置註冊過時回傳 0——最保守的答案：0 之前沒有任何墓碑，
-- 等於「什麼都還不能清」，而不是誤判成「沒人在乎，隨便清」。
create or replace function public.min_device_cursor()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(last_synced_at), 0) from public.device_cursors;
$$;

-- ------------------------------------------------ cleanup（墓碑／processed_ops）

create or replace function public.cleanup_stale_ops_and_tombstones()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- 兩個條件都要滿足才安全刪除：時間夠久（90 天），而且所有裝置都已經
  -- 同步過這個時間點——用 least() 取兩者中較早的那個當門檻，任何一個
  -- 條件不足都不會刪。
  -- 90 天換算成毫秒（90 * 86400000）超過 int4 的範圍（約 21 億），
  -- 純字面數字相乘預設是 int 運算，會在轉成 bigint 之前就溢位——
  -- 90::bigint 讓整條算式從一開始就用 bigint 運算，不是算完才轉型。
  v_tombstone_cutoff bigint := least(v_now - 90::bigint * 24 * 60 * 60 * 1000, public.min_device_cursor());
begin
  delete from public.processed_ops where created_at < now() - interval '30 days';

  delete from public.tasks where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.projects where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.tags where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.filters where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.comments where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.sections where deleted_at is not null and updated_at < v_tombstone_cutoff;
  delete from public.attachments where deleted_at is not null and updated_at < v_tombstone_cutoff;
end;
$$;

select cron.schedule('cleanup-stale-ops-and-tombstones', '0 3 * * *', $$select public.cleanup_stale_ops_and_tombstones();$$)
  where not exists (select 1 from cron.job where jobname = 'cleanup-stale-ops-and-tombstones');

-- --------------------------------------------------------------- 速率限制

-- 掛在 processed_ops 而不是逐一掛在 create_task／apply_task_patch……
-- 這些 RPC 上：每一次成功的寫入操作都會先插入 processed_ops 做 op_id
-- 去重（見 0006），這是唯一「每個寫入動作都恰好經過一次」的地方，
-- 只需要顧一個 trigger 就涵蓋所有表、所有種類的操作。
--
-- 「記錄」用 RAISE LOG，不是另外開一張表：擋下的這個操作本身連同它
-- 觸發的一切都會被整個交易回滾（含 trigger 自己在同一個交易內寫的
-- 任何東西）——Postgres 沒有內建的獨立交易，要讓紀錄真正撐過回滾，
-- 得靠 dblink／pg_background 這類額外的重量級機制。RAISE LOG 寫的是
-- 伺服器日誌，不受交易影響，天生撐得過回滾，剛好也對應計畫書自己列的
-- 觀測來源之一（「RPC 失敗率與錯誤碼分布：Postgres 日誌」），不是退而
-- 求其次的做法。
create or replace function public.enforce_op_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 每分鐘每人上限。刻意留了充裕空間給合法的大量批次操作（例如在
  -- 「全部」檢視選取上百筆任務一次改期／刪除，那會產生等量的
  -- processed_ops 列）——這裡要擋的是明顯異常的速率，不是正常重度使用。
  v_limit constant int := 300;
  v_recent_count int;
begin
  select count(*) into v_recent_count
    from public.processed_ops
   where actor_id = new.actor_id
     and created_at > now() - interval '1 minute';

  if v_recent_count >= v_limit then
    raise log '寫入速率超過門檻：actor_id=%, 近一分鐘已有 % 筆操作（門檻 %）', new.actor_id, v_recent_count, v_limit;
    raise exception '寫入速率過高，請稍後再試' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger processed_ops_rate_limit before insert on public.processed_ops
  for each row execute function public.enforce_op_rate_limit();

-- --------------------------------------------------------------- 儲存配額

-- 附件的單檔大小已經有 storage.buckets.file_size_limit 擋著（見 0014），
-- 這裡補上工作區總量——同一個工作區的所有附件（透過 task_id → project_id
-- → workspace_id 反查）加總不能超過這個值。500MB 是這個工具的量級下
-- 足夠寬裕、又不會讓單一工作區無限吃掉 Storage 配額的起始值。
-- security definer 繞過 RLS 才能加總「整個工作區」的用量（呼叫者不一定
-- 對每一筆任務都有 select 權限），所以自己在函式內重新檢查成員身分——
-- 不然任何登入使用者都能傳任意 workspace_id 探出別人工作區的用量。
create or replace function public.workspace_storage_used(p_workspace uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.workspace_role(p_workspace) is null then
    raise exception '不是這個工作區的成員';
  end if;

  return (
    select coalesce(sum(a.file_size), 0)::bigint
      from public.attachments a
      join public.tasks t on t.id = a.task_id
      join public.projects p on p.id = t.project_id
     where p.workspace_id = p_workspace
       and a.deleted_at is null
  );
end;
$$;

create or replace function public.enforce_attachment_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota constant bigint := 500 * 1024 * 1024;
  v_workspace uuid;
  v_used bigint;
begin
  select p.workspace_id into v_workspace
    from public.tasks t join public.projects p on p.id = t.project_id
   where t.id = new.task_id;

  if v_workspace is not null then
    v_used := public.workspace_storage_used(v_workspace);
    if v_used + new.file_size > v_quota then
      raise exception '這個工作區的附件容量已滿（上限 500MB），請先刪除不需要的附件';
    end if;
  end if;

  return new;
end;
$$;

create trigger attachments_enforce_quota before insert on public.attachments
  for each row execute function public.enforce_attachment_quota();

-- --------------------------------------------------------------- 觀測指標

-- 對應計畫書「墓碑與 processed_ops 列數：排程查詢」——這是唯二會無上限
-- 成長的資料，維運可以直接 `select * from public.maintenance_stats();`
-- 檢查目前規模，不需要另外接一套外部儀表板才能看到這個數字。
create or replace function public.maintenance_stats()
returns table (metric text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'processed_ops' as metric, count(*) from public.processed_ops
  union all
  select 'tombstones.tasks', count(*) from public.tasks where deleted_at is not null
  union all
  select 'tombstones.projects', count(*) from public.projects where deleted_at is not null
  union all
  select 'tombstones.tags', count(*) from public.tags where deleted_at is not null
  union all
  select 'tombstones.filters', count(*) from public.filters where deleted_at is not null
  union all
  select 'tombstones.comments', count(*) from public.comments where deleted_at is not null
  union all
  select 'tombstones.sections', count(*) from public.sections where deleted_at is not null
  union all
  select 'tombstones.attachments', count(*) from public.attachments where deleted_at is not null;
  -- 速率限制的違規次數不在這裡：見 enforce_op_rate_limit() 的說明，
  -- 那是 RAISE LOG 寫進伺服器日誌，不是這張表能查到的資料庫列。
$$;

-- security definer 繞過 RLS，回傳的是全系統（跨所有工作區、所有使用者）
-- 的加總數字——這是給維運看的，不是給一般使用者的 API，明確收回
-- PostgREST 預設會開放的呼叫權限，只留給 service_role／psql 直連。
revoke execute on function public.maintenance_stats() from anon, authenticated;
