import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFlashStore } from './flash'

function setup() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useFlashStore()
}

beforeEach(() => {
  localStorage.clear()
})

describe('flash store', () => {
  it('error() 寫入訊息並標成錯誤', () => {
    const flash = setup()
    flash.error('無法載入工作區資料，稍後會自動重試')
    expect(flash.message).toBe('無法載入工作區資料，稍後會自動重試')
    expect(flash.kind).toBe('error')
  })

  it('info() 寫入訊息並標成一般提示', () => {
    const flash = setup()
    flash.info('偏好設定沒有存下來')
    expect(flash.message).toBe('偏好設定沒有存下來')
    expect(flash.kind).toBe('info')
  })

  it('dismiss() 清掉訊息', () => {
    const flash = setup()
    flash.error('同步失敗')
    flash.dismiss()
    expect(flash.message).toBeNull()
  })

  it('後寫入的提示蓋掉前一則，不會排隊', () => {
    const flash = setup()
    flash.error('第一則')
    flash.error('第二則')
    expect(flash.message).toBe('第二則')
  })
})
