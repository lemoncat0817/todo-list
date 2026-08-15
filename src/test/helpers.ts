import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { vi } from 'vitest'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'
import { routes as appRoutes } from '@/router'
import type { StoredTask } from '@/db/schema'

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
 * 領域模型不含 isEdit —— 編輯狀態自 P1 修正後改由元件區域管理。
 * id 為字串（crypto.randomUUID 的形狀），order 為排序鍵。
 */
export function makeTask(
  taskName: string,
  isCompleted = false,
  extra: Partial<StoredTask> & Record<string, unknown> = {},
): StoredTask {
  const id = String(extra.id ?? `task-${++orderSeq}`)
  const order = typeof extra.order === 'number' ? extra.order : orderSeq
  return { ...extra, id, taskName, isCompleted, order }
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
