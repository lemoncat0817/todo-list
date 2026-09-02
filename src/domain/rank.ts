/**
 * 可插值的字串排序鍵，取代 ordering.ts 的浮點數版本。
 *
 * 浮點數中點在單人情境沒問題，但兩個人同時把不同任務拖進同一個間隙時，
 * 兩邊算出的中點是同一個數字——鍵真的會相等。字串鍵沒有精度上限
 * （碰到底就多接一個字元），加上 withJitter() 讓併發寫入自然分開，
 * 不需要偵測碰撞後重新編號整份清單。
 *
 * 字元集用 base62（0-9A-Za-z），刻意照這個順序排列：ASCII 底下
 * '0'-'9' < 'A'-'Z' < 'a'-'z'，字元值跟字典序天生一致，plain string
 * 比較就是正確的排序，不需要自訂 comparator。
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

function digitValue(c: string): number {
  return DIGITS.indexOf(c)
}

/**
 * 缺位時視同數值 0（見 between() 內的補位邏輯），所以尾端的 '0' 不帶
 * 任何資訊——"A0" 跟 "A" 是同一個值。不去掉尾端的 0，"A" 跟 "A0" 這種
 * 一個是另一個的前綴、末位補零版本的輸入會被誤判成「a 嚴格小於 b」
 * 而不是「兩者相等」，算出來的中點會跑到 b 的外面。
 */
function stripTrailingZeros(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === '0') end--
  return s.slice(0, end)
}

/**
 * 產生排在 a 與 b 之間的鍵。a／b 為 null 代表沒有下界／上界
 * （清單開頭／結尾，或清單是空的）。純函式、確定性——同樣的輸入
 * 永遠得到同樣的輸出，碰撞交給呼叫端視情況呼叫 withJitter()。
 */
export function between(a: string | null, b: string | null): string {
  a = a === null ? null : stripTrailingZeros(a)
  b = b === null ? null : stripTrailingZeros(b)

  if (a !== null && b !== null && a >= b) {
    throw new RangeError(`between(): a (${a}) 必須排在 b (${b}) 之前`)
  }
  // 去掉尾端零之後變空字串代表數值 0——字元集只有非負的數字（最小是
  // '0'），0 已經是能表示的最小值，前面不會有空間留給任何東西。
  // 正常情況下不會有呼叫端傳這種 b：between() 自己永遠不會生出這樣的
  // 鍵（見下方主流程，中點分支的結果最小是 1），只有手刻或搬遷舊資料
  // 時硬塞 "0" 這種字面值才會撞到。
  if (b === '') {
    throw new RangeError('between(): b 已經是可表示的最小值，前面沒有空間了')
  }

  const digits: number[] = []
  let i = 0
  // 第一階段：a／b 同時還在夾著這個位置。兩邊在這個位置的數值相同就
  // 照抄、繼續往下一位；不同的話，若間隔夠大就直接取中點結束，若間隔
  // 恰好是 1（例如 a 的這一位是 5、b 是 6），沒有整數夾在中間，只能
  // 抄 a 的數值、把問題留給下一位——因為抄了 a 的數值之後，這個位置
  // 已經跟 a 打平、跟 b 差 1（嚴格小於 b），字串比較在第一個不同的
  // 位置就分出勝負，所以從下一位開始其實不再受 b 的約束了。
  for (;;) {
    const da = a !== null && i < a.length ? digitValue(a[i] as string) : 0
    const db = b === null || i >= b.length ? BASE : digitValue(b[i] as string)

    if (da === db) {
      digits.push(da)
      i++
      continue
    }

    if (db - da >= 2) {
      digits.push(da + Math.floor((db - da) / 2))
      return digits.map((d) => DIGITS[d]).join('')
    }

    // db - da === 1：抄 a 的這一位，之後不再受 b 限制，改成「比 a 的
    // 剩餘部分更大即可、沒有上界」的第二階段。
    digits.push(da)
    i++
    for (;;) {
      const da2 = a !== null && i < a.length ? digitValue(a[i] as string) : 0
      if (da2 < BASE - 1) {
        digits.push(da2 + 1 + Math.floor((BASE - 1 - da2) / 2))
        return digits.map((d) => DIGITS[d]).join('')
      }
      // da2 已經是這個字元集的最大值，跟「無上界」打平，繼續往下一位。
      digits.push(da2)
      i++
    }
  }
}

/**
 * 幫一個已經合法的鍵加上隨機尾碼。between() 回傳的鍵本身已經嚴格
 * 落在 a、b 之間，接上任何字元都不會跨出這個範圍（決定大小的位置
 * 在更前面就分出來了）——所以這個函式對任何 between() 的結果都安全，
 * 用來讓兩台裝置對同一個間隙算出的鍵不要完全相同。唯一含隨機性的
 * 函式，只給實際要落地寫入的呼叫端用，不要在算「插在哪裡」的推導
 * 邏輯裡呼叫它，不然同一份輸入會算出不同結果，測試也沒辦法斷言。
 */
export function withJitter(rank: string): string {
  const c = DIGITS[Math.floor(Math.random() * BASE)] as string
  return rank + c
}

export interface Ranked {
  rank: string
  id: string
}

/**
 * 兩台裝置對同一個間隙算出相同的 rank（沒呼叫 withJitter，或呼叫了
 * 仍然巧合相同）時，用 id 當第二排序鍵，讓所有裝置得到一致的順序——
 * 不然「rank 相同時各自的陣列原始順序」在不同裝置上可能不一樣。
 */
export function compareRank(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** 依 (rank, id) 排序。不改動原陣列。 */
export function sortByRank<T extends Ranked>(items: readonly T[]): T[] {
  return [...items].sort(compareRank)
}
