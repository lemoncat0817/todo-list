-- M0 最後一步：把 tasks/projects/tags/filters 的 policy 從
-- 「user_id = auth.uid()」換成工作區／專案成員判斷。這個檔案本身是
-- 一個交易，drop 舊 policy 跟 create 新 policy 之間不會有空窗；成員表
-- 在這之前的 0004 已經回填完畢，所以新 policy 一生效判斷就是對的，
-- 不會有「規則換了但還沒有人被列為成員」的中間狀態。
--
-- 效能：project_role()/workspace_role() 都標了 stable，內部用
-- (select auth.uid()) 而不是直接呼叫，讓查詢規劃器把它當一次性求值
-- 的初始化參數而不是逐列重算；workspace_members(user_id)／
-- project_members(user_id) 在 0003 建表時就有索引。

drop policy "select own tasks" on public.tasks;
drop policy "insert own tasks" on public.tasks;
drop policy "update own tasks" on public.tasks;
drop policy "delete own tasks" on public.tasks;

create policy tasks_select on public.tasks
  for select using (public.project_role(project_id) is not null);
create policy tasks_insert on public.tasks
  for insert with check (public.can_write_task(project_id));
create policy tasks_update on public.tasks
  for update using (public.can_write_task(project_id))
          with check (public.can_write_task(project_id));
create policy tasks_delete on public.tasks
  for delete using (public.can_write_task(project_id));

drop policy "select own projects" on public.projects;
drop policy "insert own projects" on public.projects;
drop policy "update own projects" on public.projects;
drop policy "delete own projects" on public.projects;

-- 建立／改名／刪除專案限定 admin 以上（見計畫書第 5 節的角色矩陣），
-- 一般成員可以看、可以在裡面建任務，但不能動專案本身。
create policy projects_select on public.projects
  for select using (public.workspace_role(workspace_id) is not null);
create policy projects_insert on public.projects
  for insert with check (public.can_manage_project(workspace_id));
create policy projects_update on public.projects
  for update using (public.can_manage_project(workspace_id))
          with check (public.can_manage_project(workspace_id));
create policy projects_delete on public.projects
  for delete using (public.can_manage_project(workspace_id));

-- 標籤／篩選器目前是工作區共用的輕量容器，沒有 M0 尚未加上的
-- per-project 覆蓋，權限比照任務（member 以上可寫），比照專案要
-- admin 以上會讓一般成員連掛個標籤都不行，太嚴。
drop policy "select own tags" on public.tags;
drop policy "insert own tags" on public.tags;
drop policy "update own tags" on public.tags;
drop policy "delete own tags" on public.tags;

create policy tags_select on public.tags
  for select using (public.workspace_role(workspace_id) is not null);
create policy tags_insert on public.tags
  for insert with check (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));
create policy tags_update on public.tags
  for update using (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'))
          with check (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));
create policy tags_delete on public.tags
  for delete using (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));

drop policy "select own filters" on public.filters;
drop policy "insert own filters" on public.filters;
drop policy "update own filters" on public.filters;
drop policy "delete own filters" on public.filters;

create policy filters_select on public.filters
  for select using (public.workspace_role(workspace_id) is not null);
create policy filters_insert on public.filters
  for insert with check (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));
create policy filters_update on public.filters
  for update using (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'))
          with check (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));
create policy filters_delete on public.filters
  for delete using (public.workspace_role(workspace_id) in ('owner', 'admin', 'member'));
