/**
 * 同步功能是否已設定。
 *
 * 這個檔案刻意不 import 任何 sync/ 底下的其他模組——它只讀兩個環境變數，
 * 沒有任何重量級相依，所以可以放心在 App 的任何角落（側邊欄要不要顯示
 * 「帳號與同步」入口）eagerly import，不會拖到 bundle。
 *
 * 兩個變數缺一就視為未設定：半吊子的設定（例如只填了 URL）沒有意義，
 * 一律當作沒接雲端，而不是讓使用者點進去才發現壞掉。
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSyncConfigured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''

/**
 * 推播通知（M4）：獨立於同步本身的一個選配環境變數，但推播訂閱要存進
 * Supabase 的 push_subscriptions 表，所以還是得先接上同步——沒接同步
 * 卻設了這個值不會生效，isPushConfigured 兩個條件都要成立。
 */
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
export const isPushConfigured = isSyncConfigured && VAPID_PUBLIC_KEY !== ''
