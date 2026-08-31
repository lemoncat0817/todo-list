<template>
  <div ref="rootEl" class="relative">
    <button type="button" :aria-label="`排程「${taskName}」`" aria-haspopup="menu"
      :aria-expanded="open"
      class="grid size-7 place-items-center rounded text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
      @click="open = !open">
      <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linejoin="round">
        <rect x="2" y="3.5" width="12" height="10.5" rx="1.6" />
        <path d="M2 6.6h12M5.4 2v2.4M10.6 2v2.4" stroke-linecap="round" />
      </svg>
    </button>

    <ul v-if="open" role="menu" :aria-label="`排程「${taskName}」`"
      class="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-line bg-surface py-1 shadow-lg">
      <li v-for="option in options" :key="option.key" role="none">
        <button type="button" role="menuitem"
          class="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-sunken"
          @click="choose(option.value)">
          <span>{{ option.label }}</span>
          <!-- 用 ink-soft 而非 ink-faint：實測 ink-faint 在此背景上只有 4.31，未達 AA -->
          <span class="text-xs tabular-nums text-ink-soft">{{ option.hint }}</span>
        </button>
      </li>
      <li v-if="hasDueDate" role="none">
        <button type="button" role="menuitem"
          class="w-full border-t border-line px-3 py-1.5 text-left text-sm text-ink-soft transition-colors hover:bg-sunken"
          @click="choose(null)">
          清除到期日
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { addDays, today, weekdayIndex } from '@/domain/dates'

/**
 * 一鍵改期。
 *
 * 之前改一次到期日要開詳情、選日期、存檔三步；逾期清單上二十筆要順延，
 * 就是六十步。這個選單把最常見的四個目的地變成一次點擊。
 *
 * 不引元件庫：用原生按鈕加上 aria-haspopup / role="menu"，
 * 加上 Escape 與點擊外部關閉——這些行為手寫不到四十行，
 * 而既有註解已經算過，光一個 Dialog 元件就要 +26 kB gzip。
 */
defineProps<{ taskName: string; hasDueDate: boolean }>()
const emit = defineEmits<{ pick: [dueDate: string | null] }>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const options = computed(() => {
  const todayISO = today()
  const tomorrow = addDays(todayISO, 1)
  // 「本週末」＝下一個週六（今天就是週六時指今天）
  const weekend = addDays(todayISO, (6 - weekdayIndex(todayISO) + 7) % 7)
  // 「下週」＝下一個週一
  const nextWeek = addDays(todayISO, (8 - weekdayIndex(todayISO)) % 7 || 7)
  return [
    { key: 'today', label: '今天', value: todayISO, hint: todayISO.slice(5) },
    { key: 'tomorrow', label: '明天', value: tomorrow, hint: tomorrow.slice(5) },
    { key: 'weekend', label: '本週末', value: weekend, hint: weekend.slice(5) },
    { key: 'next-week', label: '下週', value: nextWeek, hint: nextWeek.slice(5) },
  ]
})

function choose(value: string | null): void {
  emit('pick', value)
  open.value = false
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!rootEl.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

// 只有選單開著時才掛全域監聽：每一列都常駐兩個 document 監聽器，
// 一份百筆的清單就是兩百個監聽器。
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>
