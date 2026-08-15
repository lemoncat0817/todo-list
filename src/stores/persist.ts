import type { PiniaPluginContext, StateTree } from 'pinia'

/**
 * 自製的持久化 plugin，取代 pinia-plugin-persistedstate。
 *
 * 換掉的理由：
 * 1. 它的 peer 限制（pinia ^2）擋住 Pinia 的升級路徑。
 * 2. 難的部分是形狀驗證，那已經在 sanitize.ts 裡了；剩下只是 localStorage 讀寫。
 * 3. 原本的 plugin 把寫入失敗完全吞掉（稽核 P12），這裡改成可觀測。
 * 4. 下一階段要換成 IndexedDB，屆時只需替換這個模組的儲存後端。
 */

export interface PersistOptions {
  /** 儲存鍵，預設使用 store.$id。 */
  key?: string
  /** 形狀驗證：只有回傳的欄位會被寫進 store。 */
  sanitize: (raw: unknown) => StateTree
}

export interface PersistFailure {
  phase: 'hydrate' | 'persist'
  key: string
  error: unknown
}

export interface PersistPluginOptions {
  storage?: Storage
  /**
   * 失敗時的回報管道。稽核 P12：配額寫滿或 Safari 無痕模式下，
   * 原本的 plugin 什麼都不做，使用者以為存好了其實沒有。
   */
  onFailure?: (failure: PersistFailure) => void
}

declare module 'pinia' {
  export interface DefineStoreOptionsBase<S, Store> {
    persist?: PersistOptions
  }
}

/** 取得可用的 storage；在沒有 localStorage 的環境（SSR、測試）回傳 null。 */
function resolveStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // Safari 在停用 cookie 時存取 localStorage 會直接拋錯
    return null
  }
}

export function createPersistPlugin(options: PersistPluginOptions = {}) {
  const { storage: explicitStorage, onFailure } = options

  return (context: PiniaPluginContext): void => {
    const persist = context.options.persist
    if (!persist) return

    const storage = resolveStorage(explicitStorage)
    if (!storage) return

    const { store } = context
    const key = persist.key ?? store.$id

    const report = (phase: PersistFailure['phase'], error: unknown) => {
      const failure: PersistFailure = { phase, key, error }
      if (onFailure) onFailure(failure)
      else console.warn(`[persist] ${phase} 失敗（${key}）`, error)
    }

    // --- 還原 ---
    try {
      const raw = storage.getItem(key)
      if (raw !== null) {
        // sanitize 負責擋掉形狀錯誤；JSON.parse 的語法錯誤由外層 catch 接住。
        store.$patch(persist.sanitize(JSON.parse(raw)))
      }
    } catch (error) {
      report('hydrate', error)
    }

    // --- 寫入 ---
    store.$subscribe(
      (_mutation, state) => {
        try {
          storage.setItem(key, JSON.stringify(state))
        } catch (error) {
          report('persist', error)
        }
      },
      { detached: true },
    )
  }
}
