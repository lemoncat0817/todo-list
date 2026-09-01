/// <reference types="vite/client" />

/**
 * 這兩個變數在建置時就會被 Vite 內嵌進產物，anon key 的設計本來就是可以公開的
 * （真正的存取控制是資料庫的 RLS，不是這把 key）——但仍然建議透過環境變數
 * 而不是寫死在原始碼裡，維持一致的謹慎程度，也方便不同環境（本機／CI／正式）
 * 各接各的 Supabase 專案。
 *
 * 兩者缺一，同步功能會整個隱藏（見 stores/sync.ts 的 isConfigured）——
 * fork 這個 repo 卻沒有接 Supabase 的人，仍然拿到完整可用的純本地版本。
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
