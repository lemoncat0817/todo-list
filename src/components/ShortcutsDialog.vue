<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,30rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-4 p-5">
      <h2 class="text-lg font-semibold tracking-tight">鍵盤快捷鍵</h2>

      <section v-for="section in SECTIONS" :key="section.title" class="flex flex-col gap-1.5">
        <h3 class="text-sm font-medium text-ink-soft">{{ section.title }}</h3>
        <dl class="flex flex-col gap-1">
          <div v-for="row in section.rows" :key="row.keys"
            class="flex items-baseline justify-between gap-4 rounded-md px-2 py-1 odd:bg-sunken">
            <dt class="text-[15px] text-ink">{{ row.action }}</dt>
            <dd class="shrink-0 font-mono text-[13px] text-ink-soft">{{ row.keys }}</dd>
          </div>
        </dl>
      </section>

      <p class="text-xs text-ink-faint">
        在輸入框裡打字時不會攔截按鍵（<span class="font-mono">Esc</span> 除外）。
      </p>

      <div class="flex justify-end">
        <button type="button"
          class="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('close')">
          關閉
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * 快捷鍵說明。
 *
 * 有了鍵盤操作卻沒有這一頁，等於只有讀過原始碼的人會用。
 * 「?」是這類工具的共同慣例，不需要再教一次。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const SECTIONS = [
  {
    title: '全域',
    rows: [
      { action: '聚焦新增欄位', keys: 'n' },
      { action: '聚焦搜尋', keys: '/' },
      { action: '命令面板', keys: 'Ctrl / ⌘ + K' },
      { action: '復原', keys: 'Ctrl / ⌘ + Z' },
      { action: '本說明', keys: '?' },
      { action: '關閉提示／取消編輯', keys: 'Esc' },
    ],
  },
  {
    title: '清單（焦點在某一列時）',
    rows: [
      { action: '上一列／下一列', keys: 'k / j 或方向鍵' },
      { action: '加入或移出批次選取', keys: 'x' },
      { action: '編輯這一列', keys: 'e' },
      { action: '排程這一列', keys: 't' },
      { action: '開啟詳情', keys: 'Enter' },
      { action: '完成／取消完成', keys: 'Space' },
      { action: '批次選取（滑鼠）', keys: 'Ctrl / ⌘ + 點擊' },
    ],
  },
] as const

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  },
)
</script>
