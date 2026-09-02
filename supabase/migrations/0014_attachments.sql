-- M3：附件。第一次真的碰 Supabase Storage——metadata（誰上傳的、檔名、
-- 大小、MIME type）存在一般的 Postgres 表，檔案本體存在 Storage 的
-- private bucket，兩者靠 storage_path 對起來。
--
-- 路徑慣例：{task_id}/{attachment_id}-{file_name}。task_id 放最前面
-- （storage.foldername(name) 取第一段）不是巧合——這是唯一一種能讓
-- storage.objects 的 RLS policy 判斷「這個檔案屬於哪筆任務」的辦法：
-- Storage 的物件本身沒有欄位可以存「屬於哪個 task_id」，只能從路徑反推。
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploader_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null,
  file_size bigint not null,
  content_type text not null,
  storage_path text not null,
  created_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  deleted_at bigint
);

create index attachments_task_idx on public.attachments (task_id);

alter table public.attachments enable row level security;

-- select：看得到任務就看得到它的附件清單（跟活動記錄同一個門檻）。
create policy attachments_select on public.attachments
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.project_role(t.project_id) is not null)
  );

-- insert／update（軟刪除）都要求 can_write_task——附件是任務內容的一部分
-- （不是個人發言），跟留言不同：留言只有作者本人能編輯／刪除自己說過的話，
-- 附件是任何有寫入權限的人都能移除，跟能不能移除任務裡的其他欄位一致。
create policy attachments_insert on public.attachments
  for insert with check (
    uploader_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and public.can_write_task(t.project_id))
  );

create policy attachments_update on public.attachments
  for update using (
    exists (select 1 from public.tasks t where t.id = task_id and public.can_write_task(t.project_id))
  )
  with check (
    exists (select 1 from public.tasks t where t.id = task_id and public.can_write_task(t.project_id))
  );

-- ------------------------------------------------------------- Storage

-- file_size_limit 是唯一擋得住單一檔案過大的地方——沒有帳號級的儲存
-- 配額（見計畫書 M6），10MB 是先擋住明顯異常的上傳，不是真正的配額
-- 機制，之後 M6 要做配額時這裡多半要重新設計，不是直接調大這個數字。
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760);

-- storage.objects 本身沒有 task_id 欄位，只能從路徑的第一段反推——
-- (storage.foldername(name))[1] 就是上傳時放進路徑的 task_id。
create policy attachments_storage_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and public.project_role(t.project_id) is not null
    )
  );

create policy attachments_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and public.can_write_task(t.project_id)
    )
  );

create policy attachments_storage_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and public.can_write_task(t.project_id)
    )
  );
