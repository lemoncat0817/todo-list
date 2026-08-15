/**
 * 全域測試環境設定。
 *
 * happy-dom 沒有 IndexedDB，而 store 在任何變更後都會嘗試寫入。
 * 沒有這一層，元件測試會在每次操作時觸發寫入失敗，
 * 測到的就不是元件本身的行為了。
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach } from 'vitest'
import { resetDBCache } from '@/db'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDBCache()
  localStorage.clear()
})
