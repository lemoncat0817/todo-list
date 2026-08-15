import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia, defineStore } from 'pinia'
import { createApp, ref } from 'vue'
import { createPersistPlugin, type PersistFailure } from '@/stores/persist'
import { sanitizeState } from '@/stores/sanitize'

/** 可控的 Storage 假件，能模擬配額耗盡。 */
class FakeStorage implements Storage {
  private map = new Map<string, string>()
  failOnWrite: Error | null = null

  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failOnWrite) throw this.failOnWrite
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

const useTestStore = defineStore(
  'todoTask',
  () => {
    const todoList = ref<{ id: number | string; taskName: string; isCompleted: boolean }[]>([])
    const isSearch = ref(false)
    const keyword = ref('')
    return { todoList, isSearch, keyword }
  },
  { persist: { sanitize: sanitizeState } },
)

const useUnpersistedStore = defineStore('plain', () => ({ n: ref(0) }))

/**
 * 注意 app.use(pinia) 這一步不能省。
 * Pinia 的 use() 在 pinia 尚未被安裝到某個 app 之前，只會把 plugin 放進
 * toBeInstalled 佇列；沒有這一步，plugin 永遠不會執行，測試會靜默地什麼都沒測到。
 */
function setup(storage: FakeStorage, onFailure?: (f: PersistFailure) => void) {
  const pinia = createPinia()
  pinia.use(createPersistPlugin(onFailure ? { storage, onFailure } : { storage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

describe('createPersistPlugin', () => {
  let storage: FakeStorage
  let failures: PersistFailure[]

  beforeEach(() => {
    storage = new FakeStorage()
    failures = []
  })

  describe('還原', () => {
    it('讀取合法資料並寫入 store', () => {
      storage.setItem(
        'todoTask',
        JSON.stringify({
          todoList: [{ id: 1, taskName: '買牛奶', isCompleted: true }],
          keyword: '牛奶',
        }),
      )
      setup(storage, (f) => failures.push(f))
      const store = useTestStore()

      expect(store.todoList).toEqual([{ id: 1, taskName: '買牛奶', isCompleted: true }])
      expect(store.keyword).toBe('牛奶')
      expect(failures).toEqual([])
    })

    it('沒有既存資料時保持預設值', () => {
      setup(storage, (f) => failures.push(f))
      const store = useTestStore()

      expect(store.todoList).toEqual([])
      expect(failures).toEqual([])
    })

    it('JSON 語法錯誤時保持預設值，並回報 hydrate 失敗', () => {
      storage.setItem('todoTask', '{todoList: [}')
      setup(storage, (f) => failures.push(f))
      const store = useTestStore()

      expect(store.todoList).toEqual([])
      expect(failures).toHaveLength(1)
      expect(failures[0]?.phase).toBe('hydrate')
      expect(failures[0]?.key).toBe('todoTask')
    })

    it('形狀錯誤由 sanitize 濾掉，不算失敗（稽核 P2）', () => {
      storage.setItem('todoTask', JSON.stringify({ todoList: 42 }))
      setup(storage, (f) => failures.push(f))
      const store = useTestStore()

      expect(store.todoList).toEqual([])
      expect(failures, 'sanitize 處理得掉的不該當成錯誤').toEqual([])
    })

    it('沒有標記 persist 的 store 完全不碰 storage', () => {
      setup(storage, (f) => failures.push(f))
      const store = useUnpersistedStore()
      store.n = 5

      expect(storage.length).toBe(0)
    })
  })

  describe('寫入', () => {
    it('狀態變更後寫回 storage', async () => {
      setup(storage)
      const store = useTestStore()
      store.todoList.push({ id: 7, taskName: '寫測試', isCompleted: false })
      await Promise.resolve()

      const raw = storage.getItem('todoTask')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).todoList).toEqual([
        { id: 7, taskName: '寫測試', isCompleted: false },
      ])
    })

    it('配額耗盡時回報 persist 失敗，不靜默吞掉（稽核 P12）', async () => {
      setup(storage, (f) => failures.push(f))
      const store = useTestStore()
      storage.failOnWrite = new DOMException('exceeded the quota', 'QuotaExceededError')

      store.todoList.push({ id: 1, taskName: '存不進去', isCompleted: false })
      await Promise.resolve()

      expect(failures).toHaveLength(1)
      expect(failures[0]?.phase).toBe('persist')
      expect((failures[0]?.error as Error).name).toBe('QuotaExceededError')
    })

    it('未提供 onFailure 時退回 console.warn，而不是拋錯', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      setup(storage)
      const store = useTestStore()
      storage.failOnWrite = new Error('boom')

      expect(() => {
        store.keyword = 'x'
      }).not.toThrow()
      await Promise.resolve()

      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('設定', () => {
    it('可自訂 storage key', async () => {
      const pinia = createPinia()
      pinia.use(createPersistPlugin({ storage }))
      createApp({}).use(pinia)
      setActivePinia(pinia)

      const useCustom = defineStore('custom', () => ({ v: ref('a') }), {
        persist: { key: 'my-key', sanitize: (raw) => (raw as object) ?? {} },
      })
      const store = useCustom()
      store.v = 'b'
      await Promise.resolve()

      expect(storage.getItem('my-key')).not.toBeNull()
      expect(storage.getItem('custom')).toBeNull()
    })
  })
})
