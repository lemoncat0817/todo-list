-- 角色變更要即時反映到已打開的分頁：被降成僅檢視的人如果還得等
-- 下一次 30 秒輪詢才重載成員名單，中間會繼續改任務、再看到同步失敗。
-- workspace_members 本來沒進 supabase_realtime publication（tasks 等
-- 表是 Dashboard 預設開的；這張表要自己加）。已加入過就略過。
do $$
begin
  alter publication supabase_realtime add table public.workspace_members;
exception
  when duplicate_object then null;
end $$;
