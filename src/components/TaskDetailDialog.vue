<template>
  <!-- 原生 <dialog> 的 showModal() 由平台提供焦點鎖定、Esc 關閉與背景 inert。
       這正是不引入元件庫的原因：實測 reka-ui 光是 Dialog 就要 +26.10 kB gzip，
       而這些行為瀏覽器本來就給。 -->
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,32rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-4 p-5">
      <h2 class="text-lg font-semibold tracking-tight">編輯代辦事項</h2>
      <TaskDetailForm :task="task" @close="close" />
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import TaskDetailForm from './TaskDetailForm.vue'
import type { StoredTask } from '@/db/schema'

/**
 * 窄螢幕的任務詳情容器。寬螢幕走 TaskDetailPanel（常駐右欄），
 * 兩者共用同一份 TaskDetailForm。
 */
const props = defineProps<{ task: StoredTask | null }>()
const emit = defineEmits<{ close: [] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)

watch(
  () => props.task,
  (task) => {
    if (!task) {
      dialogEl.value?.close()
      return
    }
    // showModal 才有焦點鎖定與背景 inert；show() 沒有
    if (!dialogEl.value?.open) dialogEl.value?.showModal()
  },
  { immediate: true },
)

function close(): void {
  dialogEl.value?.close()
}
</script>
