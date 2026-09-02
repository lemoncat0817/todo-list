-- M4：推播訂閱。存的是瀏覽器 PushManager.subscribe() 回傳的三個欄位
-- （endpoint／p256dh／auth），跟使用者、不是跟工作區綁——推播訂閱屬於
-- 「這個瀏覽器＋這個使用者」的組合，跟任何工作區的成員身分無關，一個人
-- 收到來自他所屬任何工作區的提及通知都要送到同一組訂閱。
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  -- 同一個瀏覽器重新訂閱（例如清過站台資料後）會拿到新的 endpoint，
  -- 舊的那筆永遠不會再用到，但沒有 unsubscribe 事件可以讓我們知道要
  -- 刪掉它——這裡不做自動清理，累積的訂閱頂多讓推播多送一次到一個
  -- 已經不存在的 endpoint，送不到而已，不是安全問題。
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- 只有本人看得到／建得到／刪得到自己的推播訂閱——這張表不是工作區內容，
-- 不透過 project_role／can_write_task 那套判斷。
create policy push_subscriptions_select on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));

-- ---------------------------------------------------- 觸發推播的 trigger

create extension if not exists pg_net with schema extensions;

-- edge function 的呼叫網址／驗證密鑰放進 Vault，不是寫死在 migration
-- 檔案裡——這個檔案會進版控，Vault 裡的值不會。本地開發環境用
-- `supabase secrets set` 或直接呼叫 vault.create_secret() 補上這兩筆；
-- 沒有設定時 trigger 直接跳過（安靜地不送推播，不是讓寫入任務／留言
-- 這件事本身失敗）——見下面 notify_mention() 的說明。
select vault.create_secret('', 'push_function_url', '尚未設定：send-mention-push edge function 的完整網址')
  where not exists (select 1 from vault.secrets where name = 'push_function_url');
select vault.create_secret('', 'push_function_secret', '尚未設定：呼叫 send-mention-push 時帶的共用密鑰')
  where not exists (select 1 from vault.secrets where name = 'push_function_secret');

-- security definer：要讀 vault.decrypted_secrets（一般使用者讀不到）、
-- 也要能看到 mentioned_user_ids 裡每一個 user id 對應的推播訂閱
-- （呼叫留言 insert 的人不見得跟被提及的人是同一個 workspace 角色，
-- 但這裡只是要組出 HTTP request 送出去，不是要繞過訂閱本身的 RLS）。
create or replace function public.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_user_id uuid;
begin
  if jsonb_array_length(coalesce(to_jsonb(new.mentioned_user_ids), '[]'::jsonb)) = 0 then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_function_secret';
  -- 沒設定就安靜跳過：這是「推播還沒接通」，不是「這則留言寫入失敗」，
  -- 兩件事的嚴重程度差很多，不能讓後者因為前者沒設定就一起炸掉。
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return new;
  end if;

  foreach v_user_id in array new.mentioned_user_ids loop
    if v_user_id = new.author_id then continue; end if; -- 提及自己不用通知自己
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object(
        'user_id', v_user_id,
        'comment_id', new.id,
        'task_id', new.task_id,
        'body', new.body
      )
    );
  end loop;

  return new;
end;
$$;

create trigger comments_notify_mentions
  after insert on public.comments
  for each row execute function public.notify_mentions();
