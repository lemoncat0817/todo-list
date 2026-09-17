-- 0031：到期提醒背景推播通知支援
--
-- 1) tasks 表新增 due_reminded_at 欄位，記錄該次設定的到期時間是否已發送提醒。
--    配合 trigger，當使用者修改 due_date/due_time 或重新開啟已完成任務時，
--    自動重置 due_reminded_at = null，以利下次到期時再次觸發提醒。
--
-- 2) notification_prefs 表新增 notify_on_due（到期提醒開關，預設 true）與
--    timezone（使用者裝置時區，預設 'UTC'）。
--    push_subscriptions 表同步新增 timezone 欄位。
--
-- 3) notify_user() 擴充支援 p_kind = 'due'。
--
-- 4) 建立 check_due_tasks() 預存程序，依使用者的裝置時區精準判定本地今天與現在時間，
--    並透過 pg_cron 每分鐘執行一次。沒任務到期時僅執行 microsecond 級的 partial index 掃描，
--    完全不消耗 Edge Function 額度與外部網路流量。

-- --------------------------------------------------------- 1. 擴充 tasks 表與重置 trigger

alter table public.tasks add column if not exists due_reminded_at bigint;

create index if not exists tasks_due_check_idx on public.tasks (due_date, due_time)
  where is_completed = false and deleted_at is null and due_reminded_at is null and due_date is not null and due_time is not null;

create or replace function public.reset_task_due_reminded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.due_date is distinct from old.due_date or
      new.due_time is distinct from old.due_time or
      (old.is_completed and not new.is_completed)) then
    new.due_reminded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_due_reminded on public.tasks;
create trigger tasks_reset_due_reminded before update on public.tasks
  for each row execute function public.reset_task_due_reminded();

-- --------------------------------------------------------- 2. 擴充 notification_prefs 與 push_subscriptions

alter table public.notification_prefs add column if not exists notify_on_due boolean not null default true;
alter table public.notification_prefs add column if not exists timezone text not null default 'UTC';

alter table public.push_subscriptions add column if not exists timezone text not null default 'UTC';

-- --------------------------------------------------------- 3. 擴充 notify_user() 支援 'due' 類別

create or replace function public.notify_user(p_user_id uuid, p_kind text, p_task_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enabled boolean;
  v_url text;
  v_secret text;
  v_anon_key text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select case p_kind
           when 'mention' then notify_on_mention
           when 'assignment' then notify_on_assignment
           when 'due' then notify_on_due
           else true
         end
    into v_enabled
    from public.notification_prefs where user_id = p_user_id;

  -- 沒有偏好列代表這個使用者從沒設定過，沿用預設值：全部開啟。
  if not coalesce(v_enabled, true) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, kind, task_id, detail, created_at, updated_at)
  values (p_user_id, (select auth.uid()), p_kind, p_task_id, jsonb_build_object('body', p_body), v_now, v_now);

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_function_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' or v_anon_key is null or v_anon_key = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-webhook-secret', v_secret, 'apikey', v_anon_key
    ),
    body := jsonb_build_object('user_id', p_user_id, 'kind', p_kind, 'task_id', p_task_id, 'body', p_body)
  );
end;
$$;

-- --------------------------------------------------------- 4. 建立 check_due_tasks() 掃描排程函式

create or replace function public.check_due_tasks()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
  v_local_date text;
  v_local_time text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  for v_rec in
    select t.id,
           t.task_name,
           coalesce(t.assignee_id, t.user_id) as target_user_id,
           t.due_date,
           coalesce(
             np.timezone,
             (select ps.timezone from public.push_subscriptions ps where ps.user_id = coalesce(t.assignee_id, t.user_id) and ps.timezone is not null limit 1),
             'UTC'
           ) as user_tz
      from public.tasks t
      left join public.notification_prefs np on np.user_id = coalesce(t.assignee_id, t.user_id)
     where t.is_completed = false
       and t.deleted_at is null
       and t.due_reminded_at is null
       and t.due_date is not null
       and t.due_time is not null
       and coalesce(np.notify_on_due, true) = true
     limit 100
  loop
    begin
      v_local_date := to_char(clock_timestamp() at time zone v_rec.user_tz, 'YYYY-MM-DD');
      v_local_time := to_char(clock_timestamp() at time zone v_rec.user_tz, 'HH24:MI');
    exception when others then
      v_local_date := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD');
      v_local_time := to_char(clock_timestamp() at time zone 'UTC', 'HH24:MI');
    end;

    -- 任務到期日即為今天且已過或剛好到達設定時間
    if v_rec.due_date = v_local_date and v_rec.due_time <= v_local_time then
      update public.tasks set due_reminded_at = v_now where id = v_rec.id;
      perform public.notify_user(v_rec.target_user_id, 'due', v_rec.id, v_rec.task_name);
    end if;
  end loop;
end;
$$;

-- --------------------------------------------------------- 5. 排程與既有逾期任務防護

-- 註冊每分鐘 pg_cron 排程
select cron.schedule('check-due-tasks', '* * * * *', $$select public.check_due_tasks();$$)
  where not exists (select 1 from cron.job where jobname = 'check-due-tasks');

-- 標記既有歷史逾期任務為已提醒，避免剛上線時一口氣發送舊任務的推播
update public.tasks
   set due_reminded_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
 where is_completed = false
   and deleted_at is null
   and due_reminded_at is null
   and due_date is not null
   and due_time is not null
   and (
     due_date < to_char(clock_timestamp(), 'YYYY-MM-DD')
     or (due_date = to_char(clock_timestamp(), 'YYYY-MM-DD') and due_time <= to_char(clock_timestamp(), 'HH24:MI'))
   );
