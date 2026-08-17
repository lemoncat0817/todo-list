/**
 * 排序鍵的計算。
 *
 * 放在 domain 而非 db：這是純粹的數學，不涉及任何 IO。
 * 之所以用可插值的浮點數而非整數序號，是因為整數方案在每次拖曳時
 * 都得重寫整份清單；插值只需要寫入被移動的那一列。
 */

export interface Ordered {
  order: number
}

/** 新項目的排序鍵：接在目前最大值之後。 */
export function nextOrder(items: readonly Ordered[]): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

/**
 * 算出插入到 before / after 之間的排序鍵。
 * 兩側皆為 null 代表清單是空的。
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0
  if (before === null) return (after as number) - 1
  if (after === null) return before + 1
  return (before + after) / 2
}

/** 依排序鍵由小到大。不改動原陣列。 */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

/**
 * 反覆在同一位置插入會讓間距指數縮小，最終觸及浮點精度極限。
 * 這個門檻用來判斷何時該重新編號整份清單。
 */
const MIN_GAP = 1e-6

export function needsReindex(items: readonly Ordered[]): boolean {
  const sorted = sortByOrder(items)
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] as Ordered).order - (sorted[i - 1] as Ordered).order
    if (gap > 0 && gap < MIN_GAP) return true
  }
  return false
}

/** 重新編號為 0,1,2…，保持既有順序。 */
export function reindex<T extends Ordered>(items: readonly T[]): T[] {
  return sortByOrder(items).map((item, index) => ({ ...item, order: index }))
}
