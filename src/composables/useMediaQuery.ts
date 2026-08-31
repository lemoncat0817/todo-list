import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 以 JS 讀取 media query。
 *
 * 只在「同一份內容必須用不同的 DOM 結構呈現」時使用——例如側邊欄在桌機是
 * 常駐的 <aside>、在手機是 <dialog> 抽屜。純樣式差異一律交給 CSS：
 * 用 JS 決定要不要渲染，會讓元素在斷點切換時被銷毀重建，也讓伺服器端與
 * 首次繪製的結果不一致。
 *
 * 兩份內容同時存在 DOM 裡（用 CSS 隱藏其中一份）不是選項：那會產生兩個
 * 同名的地標與重複的可聚焦元素，螢幕閱讀器會念到兩次。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  let media: MediaQueryList | null = null

  const update = (event: MediaQueryListEvent | MediaQueryList): void => {
    matches.value = event.matches
  }

  onMounted(() => {
    // Safari 停用某些 API 時 matchMedia 可能不存在；退回 false（窄版）比拋錯好
    if (typeof matchMedia !== 'function') return
    media = matchMedia(query)
    update(media)
    media.addEventListener('change', update)
  })

  onBeforeUnmount(() => media?.removeEventListener('change', update))

  return matches
}
