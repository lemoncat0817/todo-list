-- 實測發現：PostgREST 的 embedding（?select=*,profiles(*)）要求兩張表
-- 之間有直接外鍵——workspace_members.user_id／project_members.user_id／
-- invitations.invited_by 目前都只各自參照 auth.users(id)，跟 profiles
-- 沒有直接關聯，PostgREST 回報 PGRST200 找不到關聯，查不到顯示名稱。
--
-- 補一條額外的外鍵指向 profiles(id)，不是取代原本指向 auth.users(id)
-- 的那條——兩條約束同時成立沒有矛盾（profiles.id 本身就是
-- auth.users(id) 的外鍵，兩者永遠一致，見 0003 的 handle_new_user()
-- trigger：新使用者一註冊就同時建好 profiles 列）。這樣前端一次查詢
-- 就能拿到「這個工作區的成員＋各自的顯示名稱」，不需要拆成兩支請求。

alter table public.workspace_members
  add constraint workspace_members_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.project_members
  add constraint project_members_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.invitations
  add constraint invitations_invited_by_profile_fkey foreign key (invited_by) references public.profiles(id);
