import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { vi } from 'vitest'

/**
 * 每個測試都用全新的 pinia，且刻意不掛 persistedstate plugin，
 * 讓元件邏輯與持久化行為隔離測試。
 */
export function freshPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

export function mountWith(component, pinia) {
  return mount(component, { global: { plugins: [pinia] } })
}

/** 元件大量使用阻塞式對話框（稽核報告 P15），測試中攔截並記錄。 */
export function stubDialogs({ confirmReturns = true } = {}) {
  const alerts = []
  const confirms = []
  vi.spyOn(window, 'alert').mockImplementation((msg) => {
    alerts.push(msg)
  })
  vi.spyOn(window, 'confirm').mockImplementation((msg) => {
    confirms.push(msg)
    return confirmReturns
  })
  return { alerts, confirms }
}

/** 領域模型不含 isEdit —— 編輯狀態自 P1 修正後改由元件區域管理。 */
export function makeTask(taskName, isCompleted = false, extra = {}) {
  return {
    id: extra.id ?? Math.floor(Math.random() * 1e12),
    taskName,
    isCompleted,
    ...extra,
  }
}
