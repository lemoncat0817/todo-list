-- M4 剩餘部分：通知中心、每類通知的偏好設定、每日摘要信（Web Push 跟
-- 「被提及」的部分已在 0015 完成，這裡補上「被指派」的推播、把兩種
-- 事件都寫進一張使用者讀得到的通知表、讓使用者能個別關閉某一類，
-- 以及每日摘要信的排程骨架）。
--
-- 偏好設定的範圍刻意是「這一類事件要不要被記錄＋推播」，不是分開兩層
-- 「要不要進通知中心」跟「要不要推播」——多一層開關對這個工具的規模
-- 沒有實質好處，只會讓設定畫面更難懂。

create extension if not exists pg_cron;

-- Kong 會擋下沒有 apikey header 的 /functions/v1/* 請求（key-auth 外掛）
-- ——這次重新走一次完整驗證才發現：這是 Kong 這一層的規則，不是 edge
-- function 自己的 x-webhook-secret 檢查能取代的，兩者要一起帶，兩支
-- 呼叫 pg_net 的函式（下面的 notify_user()／trigger_daily_digest()）
-- 都需要。anon key 本來就是要放進前端 bundle 的公開值，存進 Vault
-- 只是跟另外幾把密鑰共用同一套「網址／密鑰放 Vault，環境間各自設定」
-- 的機制，不是把它當成真正的機密。
select vault.create_secret('', 'supabase_anon_key', '尚未設定：呼叫 /functions/v1/* 時 Kong 要求的 apikey header（本地開發可以直接用 anon key）')
  where not exists (select 1 from vault.secrets where name = 'supabase_anon_key');

-- --------------------------------------------------------- notification_prefs

create table public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_on_mention boolean not null default true,
  notify_on_assignment boolean not null default true,
  -- 每日摘要信預設關閉：跟推播不同，這是主動打擾使用者的信箱，
  -- 不該在使用者還沒同意前就開始寄。
  daily_digest_enabled boolean not null default false,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

alter table public.notification_prefs enable row level security;
create policy notification_prefs_select on public.notification_prefs
  for select using (user_id = (select auth.uid()));
create policy notification_prefs_insert on public.notification_prefs
  for insert with check (user_id = (select auth.uid()));
create policy notification_prefs_update on public.notification_prefs
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------- notifications

-- 沒有 workspace_id：通知是收件者個人的收件匣，跟「這筆資料屬於哪個
-- 工作區」無關（收件者可能在多個工作區都會收到通知），RLS 直接比對
-- user_id 就夠，不需要額外的權限判斷函式。
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 觸發這次通知的人；跟 activity_log.actor_id 同樣的理由設成可為 null。
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  detail jsonb not null default '{}',
  read_at bigint,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications
  for select using (user_id = (select auth.uid()));
-- 更新只用來標已讀——開放整列 update 而不是只開放 read_at 一欄，
-- 是因為這張表的其餘欄位（kind/task_id/detail）就算被使用者自己改壞，
-- 影響範圍也只有他自己的收件匣顯示，不是安全問題，不值得為此另外
-- 寫一支 RPC。
create policy notifications_update on public.notifications
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications
  for delete using (user_id = (select auth.uid()));
-- 刻意不開放 insert：唯一的寫入路徑是下面的 security definer 函式
-- notify_user()，避免任何人偽造一筆看起來像系統通知的訊息給別人。

-- 留言 @提及、任務指派共用的通知＋推播邏輯，從 0015 的 notify_mentions()
-- 抽出來，這樣兩種事件的「檢查偏好設定 → 寫通知列 → 呼叫推播」只有一份。
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

-- 取代 0015 版本：原本直接讀 vault／呼叫 pg_net，現在委派給 notify_user()，
-- 多了「先看偏好設定」跟「寫進通知中心」兩件事，呼叫端（comments 的
-- insert trigger）完全不用改。
create or replace function public.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  if jsonb_array_length(coalesce(to_jsonb(new.mentioned_user_ids), '[]'::jsonb)) = 0 then
    return new;
  end if;

  foreach v_user_id in array new.mentioned_user_ids
  loop
    if v_user_id = new.author_id then
      continue;
    end if;
    perform public.notify_user(v_user_id, 'mention', new.task_id, new.body);
  end loop;

  return new;
end;
$$;

-- 新的一半：任務指派。body 帶任務名稱而不是留言內容——指派事件本來
-- 就沒有使用者輸入的自由文字可以摘要，任務名稱是最有意義的內容。
create or replace function public.notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.assignee_id is null then
    return new;
  end if;
  if TG_OP = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  -- 指派給自己不必通知自己——跟 notify_mentions() 排除 @提及自己同一個理由。
  if new.assignee_id = (select auth.uid()) then
    return new;
  end if;

  perform public.notify_user(new.assignee_id, 'assignment', new.id, new.task_name);
  return new;
end;
$$;

create trigger tasks_notify_assignment after insert or update on public.tasks
  for each row execute function public.notify_assignment();

-- ----------------------------------------------------------- 每日摘要信排程

-- 跟推播用同一套「網址＋共用密鑰放 Vault，沒設定就安靜跳過」的模式
-- （見 0015），digest 是另一支獨立的 edge function，所以是另外兩把密鑰，
-- 不跟 push_function_url／push_function_secret 共用。
select vault.create_secret('', 'digest_function_url', '尚未設定：send-daily-digest edge function 的完整網址')
  where not exists (select 1 from vault.secrets where name = 'digest_function_url');
select vault.create_secret('', 'digest_function_secret', '尚未設定：呼叫 send-daily-digest 時帶的共用密鑰')
  where not exists (select 1 from vault.secrets where name = 'digest_function_secret');

-- edge function 內部會自己查「哪些使用者開了每日摘要」，這裡不用逐一
-- 呼叫——一次 pg_cron 觸發只打一次 pg_net，函式端用 service role
-- 一次查完所有訂閱摘要信的使用者，批次寄送。
create or replace function public.trigger_daily_digest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_anon_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'digest_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'digest_function_secret';
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' or v_anon_key is null or v_anon_key = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-webhook-secret', v_secret, 'apikey', v_anon_key
    )
  );
end;
$$;

-- 固定每天 09:00 UTC 觸發一次。用 job 名稱擋重複排程，migration 允許
-- 重跑（本地 `supabase db reset` 每次都會整個重放一次）不會疊出多個 job。
select cron.schedule('daily-digest', '0 9 * * *', $$select public.trigger_daily_digest();$$)
  where not exists (select 1 from cron.job where jobname = 'daily-digest');
