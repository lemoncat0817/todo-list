/**
 * 搜尋用的字串正規化（稽核 P4）。
 *
 * 原本直接用 String.includes 比對，造成兩個問題：
 * - 英文大小寫不同就找不到（keyword="buy" 找不到 "Buy Milk"）
 * - 全形英數、相容字元、組合字的輸入無法命中視覺上相同的內容
 *
 * NFKC 會把相容字元收斂成標準形式（例如全形 Ａ → A、㍿ → 株式会社），
 * 再轉小寫即可涵蓋上述兩類情況。中文不受影響。
 */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

/** 關鍵字是否命中目標字串。兩邊都會先正規化。 */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = normalizeForSearch(keyword)
  if (needle === '') return true
  return normalizeForSearch(text).includes(needle)
}
