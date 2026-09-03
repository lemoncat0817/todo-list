<template>
  <fieldset class="flex flex-col gap-2 rounded-lg border border-line p-3">
    <legend class="px-1 text-sm font-medium text-ink-soft">附件</legend>

    <p v-if="list.length === 0" class="text-sm text-ink-faint">還沒有附件</p>
    <ul v-else class="flex flex-col gap-2">
      <li v-for="attachment in list" :key="attachment.id"
        class="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
        <div class="min-w-0 grow">
          <p class="truncate text-[15px] text-ink">{{ attachment.fileName }}</p>
          <p class="text-xs text-ink-faint">
            {{ formatFileSize(attachment.fileSize) }} · {{ memberName(attachment.uploaderId) }}
          </p>
        </div>
        <button type="button"
          class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken"
          @click="handleDownload(attachment)">下載</button>
        <button v-if="workspace.canWriteTasks" type="button"
          class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
          @click="handleRemove(attachment)">刪除</button>
      </li>
    </ul>

    <p v-if="attachments.error" role="alert" class="text-sm text-danger-ink">{{ attachments.error }}</p>

    <div v-if="workspace.canWriteTasks" class="flex items-center gap-2 pt-1">
      <!--
        label 要 relative：sr-only 是 position:absolute，沒有已定位的祖先時它的
        包含區塊會是「初始包含區塊」，於是不受 App shell 的 overflow-hidden 裁切，
        直接把整份文件撐高到這個隱藏 input 的位置（詳情面板捲到下方時可達數百 px）——
        實測會多出一條頁面捲軸，整個三欄版面被捲上去、下方露出一片畫布底色。
        把包含區塊拉回 label 本身，它就跟著內容捲動也跟著被裁切。
      -->
      <label
        class="relative cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
        :aria-disabled="attachments.uploading">
        {{ attachments.uploading ? '上傳中…' : '新增附件' }}
        <input type="file" class="sr-only" :disabled="attachments.uploading" @change="handleFileSelected">
      </label>
      <span class="text-xs text-ink-faint">單一檔案最大 10MB</span>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAttachmentsStore } from '@/stores/attachments'
import { useWorkspaceStore } from '@/stores/workspace'
import { useMemberName } from '@/composables/useMemberName'
import { formatFileSize } from '@/domain/attachments'
import type { StoredAttachment } from '@/db/schema'

/**
 * 任務附件——只有在已設定同步且已登入時，容器（TaskDetailForm.vue）
 * 才會渲染這個元件：附件的檔案本體存在 Supabase Storage，純本機模式
 * 沒有地方可以存。
 *
 * 上傳／刪除都是直接打網路的一次性動作，不像留言走 outbox 可以離線
 * 排隊（見 stores/attachments.ts 開頭的說明）——離線時這裡的按鈕點了
 * 會直接顯示失敗，不是安靜地什麼都不做。
 */
const props = defineProps<{ taskId: string }>()

const attachments = useAttachmentsStore()
const workspace = useWorkspaceStore()
const memberName = useMemberName()

const list = computed(() => attachments.forTask(props.taskId))

function handleFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 選完就清空 input.value：同一個檔案選兩次也要能觸發 change 事件。
  input.value = ''
  if (!file) return
  void attachments.upload(props.taskId, file).catch(() => {
    // 錯誤已經寫進 attachments.error 顯示在畫面上，這裡只是不讓
    // 未處理的 rejection 冒出主控台噪音。
  })
}

function handleDownload(attachment: StoredAttachment): void {
  void attachments.download(attachment).catch(() => {})
}

/**
 * 這是整個專案唯一用原生 confirm() 的地方（其餘一律「先做，錯了再
 * Ctrl+Z」）——理由是附件刪除跟其他操作不一樣：檔案位元組沒有留在
 * 本機任何地方，砍掉就是真的砍掉，history.ts 的 undo/redo 命令模式
 * 幫不上忙（沒有東西可以「放回去」）。少了 undo 這條退路，才需要靠
 * 確認對話框補回一道防線，不是忘記套用既有慣例。
 */
function handleRemove(attachment: StoredAttachment): void {
  if (!window.confirm(`確定要刪除附件「${attachment.fileName}」嗎？這個動作無法復原。`)) return
  void attachments.remove(attachment).catch(() => {})
}
</script>
