import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { vi } from 'vitest'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'
import { routes as appRoutes } from '@/router'
import { DEFAULT_TASK_FIELDS, type StoredTask } from '@/db/schema'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import type { MemberRole } from '@/sync/workspaceClient'

/**
 * 每個測試都用全新的 pinia，且刻意不掛 persistedstate plugin，
 * 讓元件邏輯與持久化行為隔離測試。
 */
export function freshPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

export interface MountOptions {
  props?: Record<string, unknown>
  /** 需要 RouterLink / RouterView 的元件請傳入測試用 router。 */
  router?: Router
}

export function mountWith(component: Component, pinia: Pinia, options: MountOptions = {}) {
  const plugins: (Pinia | Router)[] = [pinia]
  if (options.router) plugins.push(options.router)
  return mount(component, {
    global: { plugins },
    ...(options.props ? { props: options.props } : {}),
  })
}

/**
 * 測試用 router：路由表與正式版相同，但改用 memory history，
 * 不需要真實的網址列，也不會在測試之間互相汙染。
 */
export function testRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes: appRoutes })
}

/** 掛載後的 wrapper 型別，供各 spec 的區域 helper 標註參數。 */
export type Wrapper = ReturnType<typeof mountWith>

export interface DialogLog {
  alerts: string[]
  confirms: string[]
}

/**
 * 元件大量使用阻塞式對話框（稽核 P15），測試中攔截並記錄。
 *
 * happy-dom 不保證提供 window.alert / window.confirm，而 vi.spyOn 無法
 * spy 不存在的屬性，所以先補上 no-op 再 spy —— 這樣 restoreAllMocks 仍然有效。
 */
export function stubDialogs({ confirmReturns = true } = {}): DialogLog {
  const alerts: string[] = []
  const confirms: string[] = []
  if (typeof window.alert !== 'function') {
    window.alert = () => {}
  }
  if (typeof window.confirm !== 'function') {
    window.confirm = () => true
  }
  vi.spyOn(window, 'alert').mockImplementation((msg?: string) => {
    alerts.push(String(msg))
  })
  vi.spyOn(window, 'confirm').mockImplementation((msg?: string) => {
    confirms.push(String(msg))
    return confirmReturns
  })
  return { alerts, confirms }
}

let orderSeq = 0

/**
 * 舊測試大量用數字 order 表達相對順序（包括偶爾用 1.5 這種「已經插值過」
 * 的值），換成 rank（字串）之後不想每個呼叫端都跟著改——這裡把數字換算
 * 成一個合法、順序一致的 rank 字串：乘 1000 消掉常見的小數精度、加偏移
 * 量避開負數、最後補一個非零字元收尾。收尾這一步是刻意的：rank 字串
 * 尾端的 0 會被 domain/rank.ts 的 between() 當成「沒有資訊」直接去掉
 * （stripTrailingZeros），兩個不同的 order 數字如果都以 0 收尾，理論上
 * 不該被那個機制視為同一個值——加這個收尾字元從根本避開這個疑慮，不用
 * 逐一檢查每個測試傳的數字會不會撞在一起。
 */
function orderToRank(n: number): string {
  const scaled = Math.round((n + 1_000_000) * 1000)
  return `${String(scaled).padStart(10, '0')}1`
}

/**
 * 建立測試用任務。
 *
 * 領域模型不含 isEdit —— 編輯狀態自 P1 修正後改由元件區域管理。
 * 其餘欄位一律補上 DEFAULT_TASK_FIELDS，避免測試資料與正式資料形狀不同。
 */
export function makeTask(
  taskName: string,
  isCompleted = false,
  extra: Partial<StoredTask> & { order?: number } & Record<string, unknown> = {},
): StoredTask {
  const seq = ++orderSeq
  const now = Date.now()
  const { order, ...rest } = extra
  return {
    ...DEFAULT_TASK_FIELDS,
    createdAt: now,
    updatedAt: now,
    ...rest,
    id: String(extra.id ?? `task-${seq}`),
    taskName,
    isCompleted,
    rank: typeof extra.rank === 'string' ? extra.rank : orderToRank(typeof order === 'number' ? order : seq),
    completedAt: isCompleted ? now : null,
  }
}

/**
 * 陣列取值後斷言非 undefined。
 * tsconfig 開了 noUncheckedIndexedAccess，測試裡明確表達「這個索引一定存在」。
 */
export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) {
    throw new Error(`索引 ${index} 不存在（長度 ${arr.length}）`)
  }
  return value
}

/** 把 wrapper 的 element 視為 HTMLInputElement，用於讀取 value / checked。 */
export function asInput(w: { element: Element }): HTMLInputElement {
  return w.element as HTMLInputElement
}

/**
 * 測試裡把目前使用者設成某工作區的成員。stores 的寫入守衛看的是
 * workspace.myRole + currentWorkspaceId，只設後者會讓 canWriteTasks
 * 變成 false（角色還沒載到時 fail-closed）。
 */
export function becomeWorkspaceMember(
  workspaceId: string,
  role: MemberRole = 'member',
  userId = 'u1',
): void {
  useAuthStore().session = {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  } as never
  const workspace = useWorkspaceStore()
  workspace.currentWorkspaceId = workspaceId
  workspace.members = [
    {
      user_id: userId,
      role,
      joined_at: '2026-01-01',
      profiles: { display_name: 'me', avatar_url: null },
    },
  ]
}
