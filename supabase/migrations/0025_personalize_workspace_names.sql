-- 0025：個人工作區名稱寫死成同一個字面字串 '個人工作區' 的 bug。
--
-- 0004 的 handle_new_user() 建立新使用者的個人工作區時，名稱一律寫死成
-- '個人工作區'，回填既有帳號的那段 insert（同一個檔案更前面）也一樣。
-- 這在「一個使用者永遠只看得到自己的工作區」的年代沒問題，但 M0 之後
-- 分享模式是直接把邀請者自己的個人工作區加人進去（accept_invitation()
-- 不會另外建一個「團隊工作區」），受邀者一接受邀請，`workspace.workspaces`
-- 裡就同時有「自己的個人工作區」跟「剛加入、邀請者的工作區」兩筆，
-- 兩筆的 name 完全相同——AppSidebar.vue 的 <select> 只是原封不動印
-- `w.name`，使用者在下拉選單裡完全分不出哪個是自己的、哪個是剛加入的。
-- 是真人測試多帳號協作時發現的，不是憑肉眼比對程式碼發現的。
--
-- 修法：改成跟 profiles.display_name 同一套算法（優先用 OAuth／註冊時的
-- full_name，沒有就退回 email 的帳號名部分），組成「<顯示名稱> 的工作區」，
-- 對每個使用者都是獨一無二的字串。同時回填所有既有的個人工作區。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_display_name text;
begin
  v_display_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));

  insert into public.profiles (id, display_name, updated_at)
  values (new.id, v_display_name, (extract(epoch from clock_timestamp()) * 1000)::bigint);

  insert into public.workspaces (name, is_personal, created_by, updated_at)
  values (v_display_name || ' 的工作區', true, new.id, (extract(epoch from clock_timestamp()) * 1000)::bigint)
  returning id into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner');

  insert into public.projects (id, user_id, name, color, rank, workspace_id, is_inbox, updated_at)
  values (gen_random_uuid(), new.id, '收件匣', '#6b7280', 'A', v_workspace, true,
          (extract(epoch from clock_timestamp()) * 1000)::bigint);

  return new;
end;
$$;

-- 回填既有的個人工作區。用 profiles.display_name（已經是同一套 coalesce
-- 算出來的值）而不是重新從 auth.users 算一次——使用者可能事後改過顯示
-- 名稱，這裡應該跟著目前的 profile 走，不是回到註冊當下的舊值。
-- display_name 理論上不該是空字串（handle_new_user 一律塞非空值），但
-- 保留 nullif(...,'') 這道防線，避免真的遇到空字串時組出「 的工作區」
-- 這種缺頭的名稱。
update public.workspaces w
set name = coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1)) || ' 的工作區',
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
from public.profiles p
join auth.users u on u.id = p.id
where w.is_personal
  and w.created_by = p.id;
