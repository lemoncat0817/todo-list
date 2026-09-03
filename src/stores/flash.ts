import { defineStore } from 'pinia'
import { ref } from 'vue'

export type FlashKind = 'error' | 'info'

/**
 * 給使用者看的短暫提示。跟 history.lastAction 分開：那個是「剛才做了什麼、
 * 可以復原」，這個是「有事情沒做成」。混在一起會讓下一次成功操作把錯誤蓋掉。
 *
 * 不走 ui store：persist plugin 會把整個 ui 狀態寫進 localStorage，
 * 錯誤提示不該在重新整理後還掛著。
 *
 * 技術細節（HTTP 狀態、PostgREST JSON）仍然由呼叫端 console.error，
 * 這裡只收已經翻譯過、可以給人看的句子。
 */
export const useFlashStore = defineStore('flash', () => {
  const message = ref<string | null>(null)
  const kind = ref<FlashKind>('error')

  function show(text: string, nextKind: FlashKind = 'error'): void {
    message.value = text
    kind.value = nextKind
  }

  function error(text: string): void {
    show(text, 'error')
  }

  function info(text: string): void {
    show(text, 'info')
  }

  function dismiss(): void {
    message.value = null
  }

  return { message, kind, show, error, info, dismiss }
})
