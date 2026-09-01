-- 讓「只有 id／deleted_at／updated_at」的墓碑列也能靠 upsert 成功建立。
--
-- sync/restClient.ts 的 upsertRows 用 on_conflict=id + resolution=merge-duplicates：
-- 遠端已經有這個 id 就走 UPDATE（沒帶到的欄位不受影響），遠端還沒有這個
-- id 就走 INSERT——這個分支是這次真正出事的地方。sync/rowMapping.ts 的
-- makeTombstone() 只送 { id, deleted_at, updated_at }，如果這個 id 從沒
-- 推送成功過（例如同步在正式打通之前就先在本機建立又刪除過，或另一台
-- 裝置離線期間建立又刪除、還沒來得及推送過），PostgREST 只能走 INSERT，
-- 這幾張表當時每一欄「not null 又沒有 default」的欄位就通通會擋下這個
-- INSERT——實測踩到的是 tasks.task_name，但 order／created_at 跟其他三張
-- 表的對應欄位是同一個問題，只是還沒被踩到。
--
-- 墓碑列的內容本來就沒有人會讀（合併邏輯只看 id／deleted_at／updated_at，
-- 見 sync/merge.ts），所以給這些欄位一個空白的預設值就足夠，不需要
-- 放寬 not null——這樣「有帶值」跟「沒帶值時的預設」語意上是一致的
-- （沒帶到的欄位在 UPDATE 分支本來就不會被動到，在 INSERT 分支現在會
-- 填一個當作沒有意義的空值，兩種情況殊途同歸）。

alter table public.tasks alter column task_name set default '';
alter table public.tasks alter column "order" set default 0;
alter table public.tasks alter column created_at set default 0;
alter table public.tasks alter column updated_at set default 0;

alter table public.projects alter column name set default '';
alter table public.projects alter column color set default '';
alter table public.projects alter column "order" set default 0;
alter table public.projects alter column updated_at set default 0;

alter table public.tags alter column name set default '';
alter table public.tags alter column color set default '';
alter table public.tags alter column updated_at set default 0;

alter table public.filters alter column name set default '';
alter table public.filters alter column query set default '';
alter table public.filters alter column color set default '';
alter table public.filters alter column "order" set default 0;
alter table public.filters alter column updated_at set default 0;
